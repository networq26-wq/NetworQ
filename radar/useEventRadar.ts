// Drives one event's Radar session: token lifecycle, BLE bridge (Android app) or
// attendee-list fallback (browser), token → profile resolution, and requests.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProximityTracker, type DistanceBucket } from "./proximity";
import { NATIVE_EVENT, isNativeToWeb, type NativeState, type PermissionState, type WebToNative } from "./protocol";
import type { IncomingRequest, PublicProfile, RadarApi, RadarEvent, RadarSettings, RequestStatus } from "./radarApi";

export interface RadarPerson {
  userId: string;
  name: string;
  title: string | null;
  company: string | null;
  avatar: string | null;
  bucket: DistanceBucket | null; // null = distance hidden or unknown (browser)
  meters: number | null;
  faded: boolean;
}

export type RadarMode = "native" | "web";
export type RadarStatus =
  | "off"
  | "starting"
  | "scanning"
  | "bluetooth_off"
  | "permission_denied"
  | "permission_blocked"
  | "unsupported"
  | "scan_only"
  | "offline";

const RESOLVE_EVERY_MS = 2000;
const RENDER_EVERY_MS = 1000;
const REQUESTS_EVERY_MS = 10_000; // safety net; realtime is the instant path
const WEB_LIST_EVERY_MS = 15_000;
const TOKEN_REFRESH_LEAD_MS = 120_000;
const UNRESOLVABLE_RETRY_MS = 60_000;

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(msg: string): void };
  }
}

const hasNativeShell = () => typeof window !== "undefined" && !!window.ReactNativeWebView;
// "denied" before we've asked just means "not requested yet" — only trust it after a start
let startRequested = false;
const postNative = (msg: WebToNative) => {
  if (msg.type === "radar:start") startRequested = true;
  if (msg.type === "radar:stop") startRequested = false;
  window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
};

export function useEventRadar(opts: {
  api: RadarApi;
  supabase?: import("@supabase/supabase-js").SupabaseClient;
  event: RadarEvent | null;
  onContactsChanged: () => void;
  onError?: (message: string) => void;
}) {
  const { api, event, onContactsChanged, onError } = opts;
  const eventId = event?.id ?? null;

  const [settings, setSettings] = useState<RadarSettings | null>(event?.settings ?? null);
  const [mode, setMode] = useState<RadarMode>(hasNativeShell() ? "native" : "web");
  const [nativeState, setNativeState] = useState<NativeState | null>(null);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [scanOnly, setScanOnly] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [people, setPeople] = useState<RadarPerson[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<Map<string, RequestStatus>>(new Map());
  const [outgoingIds, setOutgoingIds] = useState<Map<string, string>>(new Map());

  const tracker = useRef(new ProximityTracker());
  const profiles = useRef(new Map<string, PublicProfile>());
  const unresolvable = useRef(new Map<string, number>());
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => setSettings(event?.settings ?? null), [eventId, event?.settings]);

  // Fresh state per event
  useEffect(() => {
    tracker.current = new ProximityTracker();
    profiles.current.clear();
    unresolvable.current.clear();
    setPeople([]);
    setHiddenCount(0);
    setIncoming([]);
    setOutgoing(new Map());
  }, [eventId]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // ── Native bridge ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasNativeShell()) return;
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (!isNativeToWeb(msg)) return;
      switch (msg.type) {
        case "radar:capabilities":
          setNativeState(msg.state);
          setPermission(startRequested || msg.permission === "granted" ? msg.permission : null);
          if (msg.state === "unsupported") setMode("web");
          break;
        case "radar:state":
          setNativeState(msg.state);
          if (msg.state !== "unauthorized") setPermission("granted");
          break;
        case "radar:sightings":
          tracker.current.ingest(msg.items);
          break;
        case "radar:error":
          if (msg.code.startsWith("advertise") || msg.code === "too_many_advertisers" || msg.code === "data_too_large") setScanOnly(true);
          break;
      }
    };
    window.addEventListener(NATIVE_EVENT, handler);
    postNative({ type: "radar:capabilities" });
    return () => window.removeEventListener(NATIVE_EVENT, handler);
  }, []);

  const active = !!eventId && !!settings?.radar_on;
  const visible = !!settings?.visible;

  // Token lifecycle + BLE start/stop (Android app)
  const [startNonce, setStartNonce] = useState(0);
  useEffect(() => {
    if (mode !== "native" || !active || !eventId) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const issue = async (first: boolean) => {
      try {
        const { token, expires_at } = await api.issueToken(eventId);
        if (cancelled) return;
        postNative(first ? { type: "radar:start", token } : { type: "radar:token", token });
        const wait = Math.max(30_000, new Date(expires_at).getTime() - Date.now() - TOKEN_REFRESH_LEAD_MS);
        refreshTimer = setTimeout(() => issue(false), wait);
      } catch (err: any) {
        if (cancelled) return;
        onErrorRef.current?.(err.message);
        refreshTimer = setTimeout(() => issue(first), 15_000); // offline / transient — retry
      }
    };
    setScanOnly(false);
    issue(true);
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      postNative({ type: "radar:stop" });
    };
  }, [api, mode, active, visible, eventId, startNonce]);

  // Resolve unknown tokens → public profiles (server enforces same event + consent settings)
  useEffect(() => {
    if (mode !== "native" || !active || !eventId) return;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      const now = Date.now();
      const pending = tracker.current
        .unknownTokens(now)
        .filter((t) => now - (unresolvable.current.get(t) ?? 0) > UNRESOLVABLE_RETRY_MS);
      if (!pending.length) return;
      busy = true;
      try {
        const res = await api.resolveTokens(eventId, pending);
        const found = new Set<string>();
        for (const p of res.people) {
          found.add(p.token);
          tracker.current.bindUser(p.token, p.user_id);
          profiles.current.set(p.user_id, p);
        }
        for (const t of pending) if (!found.has(t)) unresolvable.current.set(t, now);
        setHiddenCount(res.hidden_count);
      } catch {
        // keep last known people; next tick retries
      } finally {
        busy = false;
      }
    }, RESOLVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [api, mode, active, eventId]);

  // Render tick: tracker → people
  useEffect(() => {
    if (mode !== "native" || !active) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const next: RadarPerson[] = [];
      for (const [userId, track] of tracker.current.byUser(now)) {
        const p = profiles.current.get(userId);
        if (!p) continue;
        next.push({
          userId,
          name: p.name,
          title: p.title,
          company: p.company,
          avatar: p.avatar,
          bucket: p.show_distance ? track.bucket : null,
          meters: p.show_distance ? track.meters : null,
          faded: track.faded,
        });
      }
      next.sort((a, b) => (a.meters ?? 1e9) - (b.meters ?? 1e9));
      setPeople(next);
    }, RENDER_EVERY_MS);
    return () => clearInterval(timer);
  }, [mode, active]);

  // Browser fallback: attendee list without distance
  useEffect(() => {
    if (mode !== "web" || !active || !eventId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.listAttendees(eventId);
        if (cancelled) return;
        setPeople(res.people.map((p) => ({ userId: p.user_id, name: p.name, title: p.title, company: p.company, avatar: p.avatar, bucket: null, meters: null, faded: false })));
        setHiddenCount(res.hidden_count);
      } catch {
        /* retry on next tick */
      }
    };
    load();
    const timer = setInterval(load, WEB_LIST_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, mode, active, eventId, visible]);

  useEffect(() => {
    if (!active) setPeople([]);
  }, [active]);

  // Connection requests
  const loadRequests = useCallback(async () => {
    if (!eventId) return;
    try {
      const res = await api.myRequests(eventId);
      setIncoming(res.incoming);
      // cancelled requests read as "no request" so Connect is offered again
      setOutgoing(new Map(res.outgoing.filter((o) => o.status !== "cancelled").map((o) => [o.to_user, o.status])));
      setOutgoingIds(new Map(res.outgoing.filter((o) => o.id).map((o) => [o.to_user, o.id as string])));
    } catch {
      /* polled again shortly */
    }
  }, [api, eventId]);

  useEffect(() => {
    if (!eventId) return;
    loadRequests();
    // Realtime: any change to a request involving me refreshes instantly; polling is the fallback
    const channel = opts.supabase
      ?.channel(`requests:${eventId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "connection_requests", filter: `event_id=eq.${eventId}` }, () => loadRequests())
      .subscribe();
    const timer = setInterval(loadRequests, REQUESTS_EVERY_MS);
    return () => {
      clearInterval(timer);
      if (channel) opts.supabase?.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, loadRequests]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const updateSettings = useCallback(
    async (patch: Partial<RadarSettings>) => {
      if (!eventId || !settings) return;
      const next = { ...settings, ...patch };
      setSettings(next);
      try {
        setSettings(await api.updateSettings(eventId, next));
      } catch (err: any) {
        setSettings(settings);
        onErrorRef.current?.(err.message);
      }
    },
    [api, eventId, settings]
  );

  const connect = useCallback(
    async (userId: string) => {
      if (!eventId) return;
      setOutgoing((m) => new Map(m).set(userId, "pending"));
      try {
        const r = await api.sendRequest(eventId, userId);
        setOutgoing((m) => new Map(m).set(userId, r.status));
      } catch (err: any) {
        setOutgoing((m) => {
          const n = new Map(m);
          n.delete(userId);
          return n;
        });
        onErrorRef.current?.(err.message);
      }
    },
    [api, eventId]
  );

  const respond = useCallback(
    async (requestId: string, accept: boolean) => {
      setIncoming((list) => list.filter((r) => r.id !== requestId));
      try {
        await api.respond(requestId, accept);
        if (accept) onContactsChanged();
      } catch (err: any) {
        onErrorRef.current?.(err.message);
        loadRequests();
      }
    },
    [api, onContactsChanged, loadRequests]
  );

  const cancelRequest = useCallback(
    async (userId: string) => {
      const id = outgoingIds.get(userId);
      if (!id) return;
      setOutgoing((m) => {
        const n = new Map(m);
        n.delete(userId);
        return n;
      });
      try {
        await api.cancel(id);
      } catch (err: any) {
        onErrorRef.current?.(err.message);
      }
      loadRequests();
    },
    [api, outgoingIds, loadRequests]
  );

  const block = useCallback(
    async (userId: string) => {
      try {
        await api.block(userId);
        setPeople((list) => list.filter((p) => p.userId !== userId));
        setIncoming((list) => list.filter((r) => r.from_user !== userId));
        profiles.current.delete(userId);
      } catch (err: any) {
        onErrorRef.current?.(err.message);
      }
      loadRequests();
    },
    [api, loadRequests]
  );

  const openBluetoothSettings = useCallback(() => postNative({ type: "radar:openSettings" }), []);
  const retryPermissions = useCallback(() => setStartNonce((n) => n + 1), []);

  const status: RadarStatus = useMemo(() => {
    if (!active) return "off";
    if (!online) return "offline";
    if (mode === "web") return "scanning";
    if (permission === "blocked") return "permission_blocked";
    if (permission === "denied" || nativeState === "unauthorized") return "permission_denied";
    if (nativeState === "off") return "bluetooth_off";
    if (nativeState === "unsupported") return "unsupported";
    if (nativeState === null) return "starting";
    if (scanOnly || nativeState === "no_advertiser") return "scan_only";
    return "scanning";
  }, [active, online, mode, permission, nativeState, scanOnly]);

  return {
    mode,
    status,
    people,
    hiddenCount,
    settings,
    updateSettings,
    incoming,
    outgoing,
    connect,
    respond,
    cancelRequest,
    block,
    openBluetoothSettings,
    retryPermissions,
  };
}
