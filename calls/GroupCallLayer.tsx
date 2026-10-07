// Group calls (up to 6 people), voice or video. Peer-to-peer mesh: every phone connects to every other
// phone over WebRTC; signalling on the private Realtime channel gcall:<id> (members only).
// Rings like 1:1 calls; anyone can leave; the call ends when nobody is left.
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getCallMedia, MediaError } from "./media";

type Kind = "audio" | "video";
type Person = { id: string; name: string };
type Phase = "idle" | "incoming" | "active" | "ended";
type Peer = { pc: RTCPeerConnection; stream: MediaStream | null; pending: RTCIceCandidateInit[] };

const STUN: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
const RING_MS = 60_000;

/** Start a group call with 2–5 connections (from People → Select, or anywhere). */
export function startGroupCall(people: Person[], kind: Kind) {
  window.dispatchEvent(new CustomEvent("networq:group-call", { detail: { people, kind } }));
}
/** Open a group call from a push / notification tap. */
export function openGroupCall(callId: string) {
  window.dispatchEvent(new CustomEvent("networq:open-group-call", { detail: { callId } }));
}

const friendly = (e: any) => {
  const m = String(e?.message || "");
  if (/too_few_people/.test(m)) return "Pick at least two people for a group call.";
  if (/too_many_people/.test(m)) return "Group calls are up to 6 people (you + 5).";
  if (/not_connected/.test(m)) return "You can only call people you're connected with.";
  if (/unavailable/.test(m)) return "Someone you picked can't be called.";
  if (/rate_limited/.test(m)) return "Too many calls in a short time. Please wait a few minutes.";
  if (e instanceof MediaError) return m;
  return "Couldn't start the call. Please try again.";
};

function Tile({ stream, name, muted, mirror, video }: { stream: MediaStream | null; name: string; muted?: boolean; mirror?: boolean; video: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  const hasVideo = video && !!stream && stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live");
  return (
    <div style={{ position: "relative", borderRadius: 18, overflow: "hidden", background: "#1C1A2A", minHeight: 0, aspectRatio: "3 / 4" }}>
      <video ref={ref} autoPlay playsInline muted={muted} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: mirror ? "scaleX(-1)" : undefined, opacity: hasVideo ? 1 : 0 }} />
      {!hasVideo && (
        <span aria-hidden style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ width: 72, height: 72, borderRadius: 36, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #7C3AED, #4F46E5)", color: "#FFF", fontSize: 30, fontWeight: 700 }}>
            {(name || "?").trim().charAt(0).toUpperCase()}
          </span>
        </span>
      )}
      <span style={{ position: "absolute", left: 10, bottom: 10, maxWidth: "80%", padding: "4px 10px", borderRadius: 12, background: "rgba(0,0,0,0.55)", color: "#FFF", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </div>
  );
}

function Btn({ label, onClick, tone = "glass", active, children }: { label: string; onClick: () => void; tone?: "glass" | "red" | "green"; active?: boolean; children: React.ReactNode }) {
  const bg = tone === "red" ? "#FF3B30" : tone === "green" ? "#34C759" : active ? "#FFFFFF" : "rgba(255,255,255,0.16)";
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 64 }}>
      <button onClick={onClick} aria-label={label} aria-pressed={tone === "glass" ? !!active : undefined} className="btn-press" style={{ width: 60, height: 60, borderRadius: 30, border: "none", background: bg, color: tone === "glass" && active ? "#1C1C1E" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        {children}
      </button>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}>{label}</span>
    </span>
  );
}
const Ico = ({ d }: { d: React.ReactNode }) => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const MIC = <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /></>;
const MIC_OFF = <><path d="m2 2 20 20" /><path d="M18.89 13.23A7 7 0 0 0 19 12v-2" /><path d="M5 10v2a7 7 0 0 0 12 5" /><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12" /><path d="M12 19v3" /></>;
const CAM = <><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" /></>;
const CAM_OFF = <><path d="m2 2 20 20" /><path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8" /><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" /></>;
const PHONE = <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />;

export function GroupCallLayer({ supabase, me, apiBaseUrl, showToast }: { supabase: SupabaseClient; me: { id: string; name?: string }; apiBaseUrl: string; showToast: (m: string, t?: "success" | "error" | "info") => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [call, setCall] = useState<{ id: string; kind: Kind; host: string; hostName: string; created_at: string } | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<{ user_id: string; status: string }[]>([]);
  const [remote, setRemote] = useState<Record<string, MediaStream | null>>({});
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [endText, setEndText] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const peers = useRef(new Map<string, Peer>());
  const channel = useRef<RealtimeChannel | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const callRef = useRef(call);
  const phaseRef = useRef(phase);
  const ice = useRef<RTCIceServer[]>(STUN);
  callRef.current = call;
  phaseRef.current = phase;

  useEffect(() => {
    (window as any).__networqGroupCallBusy = phase === "incoming" || phase === "active";
  }, [phase]);
  useEffect(() => {
    if (phase !== "active") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const loadIce = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const r = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/calls/ice`, { headers: { Authorization: `Bearer ${data.session?.access_token || ""}` } });
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d.iceServers) && d.iceServers.length) ice.current = d.iceServers;
      }
    } catch {}
  }, [supabase, apiBaseUrl]);

  const send = (msg: any) => channel.current?.send({ type: "broadcast", event: "rtc", payload: { ...msg, from: me.id } });

  const closePeer = (id: string) => {
    const p = peers.current.get(id);
    if (p) {
      try {
        p.pc.close();
      } catch {}
      peers.current.delete(id);
    }
    setRemote((r) => {
      const n = { ...r };
      delete n[id];
      return n;
    });
  };

  const peerFor = (id: string): Peer => {
    let p = peers.current.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ice.current });
    p = { pc, stream: null, pending: [] };
    peers.current.set(id, p);
    localRef.current?.getTracks().forEach((t) => pc.addTrack(t, localRef.current!));
    pc.onicecandidate = (e) => e.candidate && send({ type: "candidate", to: id, candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      const s = e.streams[0] || new MediaStream([e.track]);
      p!.stream = s;
      setRemote((r) => ({ ...r, [id]: s }));
      setStartedAt((t) => t ?? Date.now());
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") closePeer(id);
    };
    return p;
  };

  const offerTo = async (id: string) => {
    const p = peerFor(id);
    if (p.pc.signalingState !== "stable") return;
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    send({ type: "offer", to: id, sdp: p.pc.localDescription!.toJSON() });
  };

  const onSignal = async (m: any) => {
    if (!m || m.from === me.id || (m.to && m.to !== me.id)) return;
    try {
      if (m.type === "hello") {
        // the lower id makes the offer, so each pair connects exactly once
        if (me.id < m.from) await offerTo(m.from);
        else if (!peers.current.has(m.from)) send({ type: "hello" });
      } else if (m.type === "offer") {
        const p = peerFor(m.from);
        await p.pc.setRemoteDescription(m.sdp);
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        const answer = await p.pc.createAnswer();
        await p.pc.setLocalDescription(answer);
        send({ type: "answer", to: m.from, sdp: p.pc.localDescription!.toJSON() });
      } else if (m.type === "answer") {
        const p = peers.current.get(m.from);
        if (p && p.pc.signalingState === "have-local-offer") {
          await p.pc.setRemoteDescription(m.sdp);
          for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        }
      } else if (m.type === "candidate") {
        const p = peerFor(m.from);
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.candidate).catch(() => {});
        else p.pending.push(m.candidate);
      } else if (m.type === "bye") {
        closePeer(m.from);
      }
    } catch (e) {
      console.warn("[gcall] signal error", e);
    }
  };

  const teardown = () => {
    send({ type: "bye" });
    peers.current.forEach((_, id) => closePeer(id));
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    setLocal(null);
    const ch = channel.current;
    channel.current = null;
    if (ch) setTimeout(() => supabase.removeChannel(ch), 400);
  };

  const finish = (text: string) => {
    const c = callRef.current;
    teardown();
    if (c) supabase.rpc("leave_group_call", { p_call_id: c.id }).then(() => {}, () => {});
    setEndText(text);
    setPhase("ended");
    setTimeout(() => {
      if (phaseRef.current === "ended") {
        setPhase("idle");
        setCall(null);
        setMembers([]);
        setRemote({});
        setMuted(false);
        setCamOff(false);
        setStartedAt(null);
      }
    }, 1800);
  };

  const loadNames = async (callId: string) => {
    const { data: ms } = await supabase.from("group_call_members").select("user_id, status").eq("call_id", callId);
    setMembers((ms || []) as any);
    const ids = (ms || []).map((m: any) => m.user_id).filter((id: string) => id !== me.id && !names[id]);
    if (ids.length) {
      const { data: chats } = await supabase.rpc("my_direct_chats");
      const map: Record<string, string> = {};
      ((chats as any[]) || []).forEach((c) => (map[c.other_user] = c.name));
      const { data: contacts } = await supabase.from("contacts").select("linked_user_id, name").in("linked_user_id", ids);
      ((contacts as any[]) || []).forEach((c) => (map[c.linked_user_id] = map[c.linked_user_id] || c.name));
      setNames((n) => ({ ...n, ...map }));
    }
  };

  // Join (as host right after starting, or as an invitee after Accept)
  const enter = async (callId: string, kind: Kind) => {
    await loadIce();
    try {
      localRef.current = await getCallMedia(kind === "video");
      setLocal(new MediaStream(localRef.current.getTracks()));
    } catch (e) {
      showToast(friendly(e), "error");
      return finish("Call ended");
    }
    const ch = supabase.channel(`gcall:${callId}`, { config: { private: true, broadcast: { self: false } } });
    channel.current = ch;
    ch.on("broadcast", { event: "rtc" }, ({ payload }) => onSignal(payload))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "group_call_members", filter: `call_id=eq.${callId}` }, (p: any) => {
        setMembers((ms) => ms.map((m) => (m.user_id === p.new.user_id ? { ...m, status: p.new.status } : m)));
        if (p.new.status === "left" || p.new.status === "declined") closePeer(p.new.user_id);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") send({ type: "hello" });
      });
    setPhase("active");
    loadNames(callId);
  };

  // Start (host)
  const start = useCallback(
    async (people: Person[], kind: Kind) => {
      if (phaseRef.current !== "idle" || (window as any).__networqCallBusy) return showToast("You're already in a call.", "info");
      const { data, error } = await supabase.rpc("start_group_call", { p_invitees: people.map((p) => p.id), p_kind: kind });
      if (error) return showToast(friendly(error), "error");
      const g = data as any;
      setNames((n) => ({ ...n, ...Object.fromEntries(people.map((p) => [p.id, p.name])) }));
      setCall({ id: g.id, kind, host: me.id, hostName: me.name || "You", created_at: g.created_at });
      await enter(g.id, kind);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, me.id]
  );

  // Incoming ring
  const ring = useCallback(
    async (callId: string) => {
      if (phaseRef.current !== "idle" || (window as any).__networqCallBusy) return;
      const { data: g } = await supabase.from("group_calls").select("*").eq("id", callId).maybeSingle();
      const { data: mine } = await supabase.from("group_call_members").select("status").eq("call_id", callId).eq("user_id", me.id).maybeSingle();
      if (!g || g.status !== "active" || !mine || (mine as any).status !== "ringing") return;
      if (Date.now() - new Date(g.created_at).getTime() > RING_MS) return;
      const { data: n } = await supabase.from("notifications").select("title").eq("dedupe_key", `gcall:${callId}`).maybeSingle();
      setCall({ id: g.id, kind: g.kind, host: g.host_id, hostName: (n as any)?.title || "Someone", created_at: g.created_at });
      setPhase("incoming");
      loadNames(callId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, me.id]
  );

  useEffect(() => {
    if (phase !== "incoming" || !call) return;
    const t = setTimeout(() => setPhase("idle"), Math.max(0, RING_MS - (Date.now() - new Date(call.created_at).getTime())));
    return () => clearTimeout(t);
  }, [phase, call]);

  // Host: nobody joined within a minute → end
  useEffect(() => {
    if (phase !== "active" || !call || call.host !== me.id) return;
    const t = setTimeout(() => {
      if (Object.keys(remote).length === 0 && !members.some((m) => m.user_id !== me.id && m.status === "joined")) finish("No one answered");
    }, RING_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, call]);

  useEffect(() => {
    const ch = supabase
      .channel(`gcalls:${me.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_call_members", filter: `user_id=eq.${me.id}` }, (p: any) => {
        if (p.new.status === "ringing") ring(p.new.call_id);
      })
      .subscribe();
    // Opened from a push, or missed the live event: a call still ringing for me
    supabase
      .from("group_call_members")
      .select("call_id, invited_at")
      .eq("user_id", me.id)
      .eq("status", "ringing")
      .gt("invited_at", new Date(Date.now() - RING_MS).toISOString())
      .order("invited_at", { ascending: false })
      .limit(1)
      .then(({ data }) => data?.[0] && ring((data[0] as any).call_id), () => {});
    const onStart = (e: any) => start(e.detail.people, e.detail.kind);
    const onOpen = (e: any) => ring(e.detail.callId);
    window.addEventListener("networq:group-call", onStart);
    window.addEventListener("networq:open-group-call", onOpen);
    const bye = () => callRef.current && phaseRef.current === "active" && supabase.rpc("leave_group_call", { p_call_id: callRef.current.id });
    window.addEventListener("pagehide", bye);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener("networq:group-call", onStart);
      window.removeEventListener("networq:open-group-call", onOpen);
      window.removeEventListener("pagehide", bye);
    };
  }, [supabase, me.id, ring, start]);

  if (phase === "idle" || !call) return null;
  const video = call.kind === "video";
  const others = members.filter((m) => m.user_id !== me.id);
  const inCall = others.filter((m) => m.status === "joined" || remote[m.user_id]);
  const ringingCount = others.filter((m) => m.status === "ringing").length;
  const status =
    phase === "incoming"
      ? `${video ? "Group video call" : "Group call"} · ${members.length} people`
      : phase === "ended"
        ? endText
        : Object.keys(remote).length
          ? `${Object.keys(remote).length + 1} in call · ${startedAt ? `${Math.floor((now - startedAt) / 60000)}:${String(Math.floor(((now - startedAt) % 60000) / 1000)).padStart(2, "0")}` : ""}`
          : ringingCount
            ? `Ringing ${ringingCount} ${ringingCount === 1 ? "person" : "people"}…`
            : "Connecting…";
  const tiles = Object.entries(remote);
  const cols = tiles.length + 1 <= 2 ? 1 : 2;

  return (
    <div role="dialog" aria-modal="true" aria-label="Group call" className="nq-call" style={{ position: "fixed", inset: 0, zIndex: 10000, background: "linear-gradient(180deg, #1B1530 0%, #0B0B10 100%)", color: "#FFFFFF", display: "flex", flexDirection: "column", padding: "calc(var(--safe-top, env(safe-area-inset-top, 0px)) + 16px) 16px calc(var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 24px)", boxSizing: "border-box" }}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{phase === "incoming" ? call.hostName : "Group call"}</div>
        <div role="status" aria-live="polite" style={{ fontSize: 15, color: "rgba(255,255,255,0.75)", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{status}</div>
        {phase !== "incoming" && others.length > 0 && (
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>{others.map((m) => names[m.user_id] || "…").join(" · ")}</div>
        )}
      </div>

      {phase === "incoming" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <div style={{ display: "flex", gap: -8 }}>
            {members.slice(0, 5).map((m) => (
              <span key={m.user_id} aria-hidden style={{ width: 64, height: 64, borderRadius: 32, marginLeft: -10, border: "3px solid #1B1530", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #7C3AED, #4F46E5)", fontSize: 24, fontWeight: 700 }}>
                {(m.user_id === me.id ? me.name || "Y" : names[m.user_id] || "?").charAt(0).toUpperCase()}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 15, color: "rgba(255,255,255,0.75)", textAlign: "center", maxWidth: 300 }}>
            {call.hostName} is calling you{members.length > 2 ? ` and ${members.length - 2} other${members.length - 2 === 1 ? "" : "s"}` : ""}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 10, alignContent: "center", overflowY: "auto" }}>
          {tiles.map(([id, s]) => (
            <Tile key={id} stream={s} name={names[id] || "Guest"} video={video} />
          ))}
          <Tile stream={local} name="You" muted mirror video={video && !camOff} />
          {tiles.length === 0 && inCall.length === 0 && <div />}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 18, flexWrap: "wrap" }}>
        {phase === "incoming" ? (
          <>
            <Btn label="Decline" tone="red" onClick={() => { supabase.rpc("leave_group_call", { p_call_id: call.id }).then(() => {}, () => {}); setPhase("idle"); setCall(null); }}>
              <span style={{ transform: "rotate(135deg)", display: "flex" }}><Ico d={PHONE} /></span>
            </Btn>
            <Btn
              label="Join"
              tone="green"
              onClick={async () => {
                const { data, error } = await supabase.rpc("join_group_call", { p_call_id: call.id });
                if (error || (data as any)?.status !== "joined") {
                  showToast("That call has ended.", "info");
                  setPhase("idle");
                  return;
                }
                await enter(call.id, call.kind);
              }}
            >
              <Ico d={video ? CAM : PHONE} />
            </Btn>
          </>
        ) : phase === "ended" ? null : (
          <>
            <Btn label={muted ? "Unmute" : "Mute"} active={muted} onClick={() => { localRef.current?.getAudioTracks().forEach((t) => (t.enabled = muted)); setMuted(!muted); }}>
              <Ico d={muted ? MIC_OFF : MIC} />
            </Btn>
            {video && (
              <Btn label={camOff ? "Camera on" : "Camera off"} active={camOff} onClick={() => { localRef.current?.getVideoTracks().forEach((t) => (t.enabled = camOff)); setCamOff(!camOff); }}>
                <Ico d={camOff ? CAM_OFF : CAM} />
              </Btn>
            )}
            <Btn label="Leave" tone="red" onClick={() => finish("You left the call")}>
              <span style={{ transform: "rotate(135deg)", display: "flex" }}><Ico d={PHONE} /></span>
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}
