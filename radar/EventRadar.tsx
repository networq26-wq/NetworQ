// Event Radar screen: join/create an event, live radar, nearby list,
// consent-based connection requests and privacy controls.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { I, Skeleton } from "../ui/icons";
import QRCode from "qrcode";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RadarCanvas } from "./RadarCanvas";
import { BUCKET_LABEL } from "./proximity";
import { createRadarApi, type RadarEvent, type RadarSettings } from "./radarApi";
import { useEventRadar, type RadarPerson, type RadarStatus } from "./useEventRadar";
import { haptic } from "../notifications/useNotifications";

const PURPLE = "#7C3AED";
const STORAGE_KEY = "networq_radar_event";

interface Theme {
  bg: string;
  surface: string;
  raised: string;
  text: string;
  muted: string;
  border: string;
}

const themeFor = (isDark: boolean): Theme =>
  isDark
    ? { bg: "#000000", surface: "#1C1C1E", raised: "#2C2C2E", text: "#FFFFFF", muted: "#AEAEB2", border: "rgba(255,255,255,0.08)" }
    : { bg: "#F2F2F7", surface: "#FFFFFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", border: "rgba(0,0,0,0.08)" };

const readStored = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};
const writeStored = (id: string | null) => {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
};

export interface ListedEventInput {
  externalId: string;
  name: string;
  venue?: string | null;
  startsAt?: string | null;
}

export function EventRadar({
  supabase,
  isDark,
  showToast,
  onContactsChanged,
  pendingJoinCode,
  pendingListedEvent,
  onPendingHandled,
  onOpenEventsHub,
  onOpenChat,
  onOpenEventChat,
}: {
  supabase: SupabaseClient;
  isDark: boolean;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  onContactsChanged: () => void;
  pendingJoinCode?: string | null;
  pendingListedEvent?: ListedEventInput | null;
  onPendingHandled?: () => void;
  onOpenEventsHub?: () => void;
  onOpenChat?: (partner: { id: string; name: string; avatar_url?: string | null; role?: string | null; company?: string | null }) => void;
  onOpenEventChat?: (eventId: string, eventName: string) => void;
}) {
  const t = themeFor(isDark);
  const api = useMemo(() => createRadarApi(supabase), [supabase]);
  const [events, setEvents] = useState<RadarEvent[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(readStored());
  const [selected, setSelected] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"nearby" | "events">(() => (readScope() || "nearby"));
  const [nearby, setNearby] = useState<RadarEvent | null | undefined>(undefined); // undefined = loading

  const loadEvents = useCallback(async () => {
    try {
      const list = await api.myEvents();
      setEvents(list);
      return list;
    } catch (err: any) {
      showToast(err.message, "error");
      setEvents([]);
      return [];
    }
  }, [api, showToast]);

  useEffect(() => {
    loadEvents();
    // Keep "N joined" current as people join or leave
    const timer = setInterval(() => {
      api.myEvents().then(setEvents).catch(() => {});
    }, 20_000);
    return () => clearInterval(timer);
  }, [loadEvents, api]);

  const activeEvent = useMemo(() => {
    if (!events?.length) return null;
    return events.find((e) => e.id === activeId) || events[0];
  }, [events, activeId]);

  useEffect(() => writeStored(activeEvent?.id ?? null), [activeEvent?.id]);
  useEffect(() => writeScope(scope), [scope]);
  useEffect(() => {
    api.nearbyStatus().then(setNearby).catch(() => setNearby(null));
  }, [api]);

  const setNearbyOn = async (on: boolean, discoverable = true) => {
    setBusy(true);
    try {
      if (on) setNearby(await api.joinNearby(discoverable));
      else {
        await api.leaveNearby();
        setNearby(null);
      }
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const enterEvent = useCallback(
    async (ev: RadarEvent, message: string) => {
      const list = await loadEvents();
      setActiveId(ev.id);
      setScope("events");
      if (!list.some((e) => e.id === ev.id)) setEvents((cur) => [ev, ...(cur || [])]);
      showToast(message, "success");
    },
    [loadEvents, showToast]
  );

  const joinByCode = useCallback(
    async (code: string) => {
      if (!code.trim()) return;
      setBusy(true);
      try {
        const ev = await api.joinByCode(code);
        await enterEvent(ev, `You're in: ${ev.name}`);
      } catch (err: any) {
        showToast(err.message, "error");
      } finally {
        setBusy(false);
      }
    },
    [api, enterEvent, showToast]
  );

  // Deep links (?join=CODE) and "I'm attending" from Events Hub
  useEffect(() => {
    if (pendingJoinCode) {
      joinByCode(pendingJoinCode).finally(() => onPendingHandled?.());
    } else if (pendingListedEvent) {
      setBusy(true);
      api
        .joinListed(pendingListedEvent.externalId, pendingListedEvent.name, pendingListedEvent.venue, pendingListedEvent.startsAt)
        .then((ev) => enterEvent(ev, `You're attending ${ev.name}`))
        .catch((err) => showToast(err.message, "error"))
        .finally(() => {
          setBusy(false);
          onPendingHandled?.();
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJoinCode, pendingListedEvent]);

  const radar = useEventRadar({
    api,
    supabase,
    event: scope === "nearby" ? nearby || null : activeEvent,
    onContactsChanged,
    onError: (m) => showToast(m, "error"),
  });

  const selectedPerson = radar.people.find((p) => p.userId === selected) || null;

  const leave = async () => {
    if (!activeEvent) return;
    try {
      await api.leave(activeEvent.id);
      setActiveId(null);
      await loadEvents();
      showToast("You left the event.", "info");
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const card: React.CSSProperties = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 20, padding: 20 };

  const radarBody = (
    <>
          <StatusBanner t={t} status={radar.status} mode={radar.mode} nearby={scope === "nearby"} onBluetooth={radar.openBluetoothSettings} onRetry={radar.retryPermissions} />

          {radar.incoming.length > 0 && (
            <section style={card} aria-label="Connection requests">
              <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Connection requests · {radar.incoming.length}</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {radar.incoming.map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Avatar url={r.avatar} size={40} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <div style={{ color: t.muted, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[r.title, r.company].filter(Boolean).join(" · ") || "Attendee"}
                      </div>
                    </div>
                    <button style={btn(t, "ghost")} onClick={() => radar.respond(r.id, false)}>
                      Decline
                    </button>
                    <button
                      style={btn(t, "primary")}
                      onClick={async () => {
                        haptic([20, 40, 20]);
                        await radar.respond(r.id, true);
                        showToast(`${r.name} added to your contacts`, "success");
                      }}
                    >
                      Accept
                    </button>
                    <ConfirmLink t={t} label="Block" confirmLabel="Block?" ariaLabel={`Block ${r.name}`} onConfirm={() => radar.block(r.from_user).then(() => showToast(`${r.name} blocked`, "info"))} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* In a browser on Nearby there's no radar to draw — skip the empty card (the list below explains) */}
          {!(radar.settings?.radar_on && radar.mode === "web" && scope === "nearby" && !radar.hiddenCount) && (
          <section style={{ ...card, padding: 16 }}>
            {radar.settings?.radar_on ? (
              <>
                {/* The live radar needs Bluetooth, which only the Android app has — browsers show a list instead */}
                {radar.mode === "native" && (
                  <RadarCanvas people={radar.people} isDark={isDark} onSelect={setSelected} scanning={radar.status === "scanning" || radar.status === "scan_only"} />
                )}
                {!(radar.mode === "web" && scope === "nearby") && (
                  <p style={{ textAlign: "center", color: t.muted, fontSize: 12, margin: radar.mode === "native" ? "10px 0 0" : 0 }}>
                    {radar.mode === "native" ? "Rings show approximate distance, not direction. Walls and crowds affect accuracy." : "Attendees active at this event in the last 15 minutes."}
                  </p>
                )}
                {radar.hiddenCount > 0 && (
                  <p style={{ textAlign: "center", fontSize: 13, margin: "10px 0 0" }}>
                    {radar.hiddenCount} {radar.hiddenCount === 1 ? "person is" : "people are"} nearby. Turn on visibility to see who.
                  </p>
                )}
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "16px 12px" }}>
                <RadarCanvas people={[]} isDark={isDark} onSelect={() => {}} scanning={false} />
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 12, marginBottom: 4 }}>Radar is off</div>
                <div style={{ color: t.muted, fontSize: 13, marginBottom: 14 }}>Turn on Radar to discover people around you.</div>
                <button style={{ ...btn(t, "primary"), padding: "10px 20px" }} onClick={() => radar.updateSettings({ radar_on: true })}>
                  Turn on Radar
                </button>
              </div>
            )}
          </section>
          )}

          {radar.settings?.radar_on && (
            <NearbyList
              t={t}
              card={card}
              people={radar.people}
              outgoing={radar.outgoing}
              onSelect={setSelected}
              onConnect={(id) => {
                haptic(25);
                radar.connect(id);
              }}
              onCancel={radar.cancelRequest}
              mode={radar.mode}
              nearbyScope={scope === "nearby"}
            />
          )}

          {radar.settings && <PrivacyPanel t={t} card={card} settings={radar.settings} onChange={radar.updateSettings} nearby={scope === "nearby"} />}
    </>
  );

  if (events === null) {
    return (
      <div role="status" aria-label="Loading Radar" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton w="100%" h={40} r={12} style={{ maxWidth: 360, alignSelf: "center" }} />
        <div style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <Skeleton w="50%" h={22} />
          <Skeleton w="80%" h={13} />
          <Skeleton w="100%" h={48} r={12} />
          <Skeleton w="100%" h={48} r={12} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, color: t.text, paddingBottom: "calc(var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 96px)" }}>
      <ScopeSwitch t={t} scope={scope} onChange={setScope} />
      {scope === "nearby" ? (
        nearby === undefined ? (
          <div role="status" aria-label="Loading Nearby" style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <Skeleton w={72} h={72} r={36} />
            <Skeleton w="55%" h={20} />
            <Skeleton w="75%" h={13} />
            <Skeleton w={220} h={48} r={12} />
          </div>
        ) : !nearby ? (
          <>
            <section style={{ ...card, padding: 16 }}>
              <RadarCanvas people={[]} isDark={isDark} onSelect={() => {}} scanning={busy} />
              <div style={{ textAlign: "center", padding: "16px 12px 6px" }}>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Find people near you</div>
                <div style={{ color: t.muted, fontSize: 14, maxWidth: 440, margin: "0 auto 16px", lineHeight: 1.5 }}>
                  See NetworQ users within Bluetooth range — at a café, a meetup or an office — and send a request, like AirDrop. No event needed.
                </div>
                <button
                  style={{ ...btn(t, "primary"), padding: "12px 28px", fontSize: 15 }}
                  disabled={busy}
                  onClick={() => setNearbyOn(true, true)}
                >
                  {busy ? "Turning on…" : "Turn on Nearby"}
                </button>
                <p style={{ color: t.muted, fontSize: 12, lineHeight: 1.45, maxWidth: 360, margin: "14px auto 0" }}>
                  You'll be discoverable to people close by. Your phone shares a random ID that changes every 15 minutes — never your location — and nobody can browse a list of who's on Nearby.
                </p>
              </div>
            </section>
          </>
        ) : (
          <>
            <section style={card} aria-label="Nearby">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.01em" }}>Nearby</h2>
                  <div style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>NetworQ people within range — live proximity radar.</div>
                </div>
                <ConfirmLink t={t} label="Turn off" confirmLabel="Turn off?" ariaLabel="Turn off Nearby" onConfirm={() => setNearbyOn(false)} />
              </div>
              <Switch
                t={t}
                label="Discoverable"
                hint={radar.settings?.visible ? "People near you can see you and send a request." : "Hidden. You'll only see how many people are near."}
                checked={!!radar.settings?.visible}
                onChange={(v) => radar.updateSettings({ visible: v })}
              />
            </section>
            {radarBody}
          </>
        )
      ) : !activeEvent ? (
        <>
          <NoEvent
            t={t}
            card={card}
            busy={busy}
            onJoin={joinByCode}
            onCreate={async (name, venue) => {
              setBusy(true);
              try {
                const ev = await api.createEvent(name, venue);
                await enterEvent(ev, `Event created — share code ${ev.join_code}`);
                setShareOpen(true);
              } catch (err: any) {
                showToast(err.message, "error");
              } finally {
                setBusy(false);
              }
            }}
            onOpenEventsHub={onOpenEventsHub}
          />
        </>
      ) : (
        <>
          <EventHeader
            t={t}
            card={card}
            event={activeEvent}
            events={events}
            onSwitch={setActiveId}
            onShare={() => setShareOpen(true)}
            onLeave={leave}
            onAddEvent={() => setActiveId("__new__")}
            onOpenRoomChat={() => onOpenEventChat?.(activeEvent.id, activeEvent.name)}
          />

          {radarBody}
        </>
      )}

      {scope === "events" && activeId === "__new__" && activeEvent && (
        <Sheet t={t} title="Join another event" onClose={() => setActiveId(activeEvent.id)}>
          <NoEvent
            t={t}
            card={{}}
            busy={busy}
            compact
            onJoin={joinByCode}
            onCreate={async (name, venue) => {
              try {
                const ev = await api.createEvent(name, venue);
                await enterEvent(ev, `Event created — share code ${ev.join_code}`);
                setShareOpen(true);
              } catch (err: any) {
                showToast(err.message, "error");
              }
            }}
            onOpenEventsHub={onOpenEventsHub}
          />
        </Sheet>
      )}

      {shareOpen && activeEvent && <ShareSheet t={t} event={activeEvent} onClose={() => setShareOpen(false)} showToast={showToast} />}

      {selectedPerson && (
        <Sheet t={t} title={selectedPerson.name} onClose={() => setSelected(null)}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
            <Avatar url={selectedPerson.avatar} size={84} />
            <div style={{ fontSize: 20, fontWeight: 700 }}>{selectedPerson.name}</div>
            <div style={{ color: t.muted }}>{[selectedPerson.title, selectedPerson.company].filter(Boolean).join(" · ") || "Attendee"}</div>
            <DistanceChip t={t} person={selectedPerson} />
            <p style={{ color: t.muted, fontSize: 13, maxWidth: 320 }}>
              Contact details are shared only if {selectedPerson.name.split(" ")[0]} accepts your request.
            </p>
            {radar.outgoing.get(selectedPerson.userId) === "accepted" ? (
              <button
                style={{ ...btn(t, "primary"), width: "100%", maxWidth: 320, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                onClick={() => {
                  setSelected(null);
                  onOpenChat?.({
                    id: selectedPerson.userId,
                    name: selectedPerson.name,
                    avatar_url: selectedPerson.avatar,
                    role: selectedPerson.title,
                    company: selectedPerson.company,
                  });
                }}
              >
                <I.Mail size={15} /> Message on NetworQ
              </button>
            ) : (
              <ConnectButton t={t} status={radar.outgoing.get(selectedPerson.userId)} onConnect={() => radar.connect(selectedPerson.userId)} onCancel={() => radar.cancelRequest(selectedPerson.userId)} wide />
            )}
            <ConfirmLink
              t={t}
              label="Block"
              confirmLabel="Tap again to block"
              ariaLabel={`Block ${selectedPerson.name}`}
              onConfirm={async () => {
                await radar.block(selectedPerson.userId);
                setSelected(null);
                showToast(`${selectedPerson.name} blocked. You won't see each other on Radar.`, "info");
              }}
            />
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────
const SCOPE_KEY = "networq.radar.scope";
function readScope(): "nearby" | "events" | null {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    return v === "nearby" || v === "events" ? v : null;
  } catch {
    return null;
  }
}
function writeScope(v: "nearby" | "events") {
  try {
    localStorage.setItem(SCOPE_KEY, v);
  } catch {}
}

function ScopeSwitch({ t, scope, onChange }: { t: Theme; scope: "nearby" | "events"; onChange: (s: "nearby" | "events") => void }) {
  return (
    <div role="tablist" aria-label="Radar mode" style={{ display: "flex", padding: 3, borderRadius: 12, background: t.raised, alignSelf: "center", width: "100%", maxWidth: 360 }}>
      {(["nearby", "events"] as const).map((k) => (
        <button
          key={k}
          role="tab"
          aria-selected={scope === k}
          onClick={() => onChange(k)}
          style={{ flex: 1, minHeight: 34, borderRadius: 9, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: scope === k ? t.surface : "transparent", color: scope === k ? t.text : t.muted, boxShadow: scope === k ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}
        >
          {k === "nearby" ? "Nearby" : "Events"}
        </button>
      ))}
    </div>
  );
}


function btn(t: Theme, kind: "primary" | "ghost" | "danger"): React.CSSProperties {
  const base: React.CSSProperties = {
    minHeight: 44,
    padding: "10px 16px",
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    border: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  };
  if (kind === "primary") return { ...base, background: PURPLE, color: "#FFFFFF" };
  if (kind === "danger") return { ...base, background: "transparent", color: "#FF453A", border: `1px solid ${t.border}` };
  return { ...base, background: t.raised, color: t.text, border: `1px solid ${t.border}` };
}

function Avatar({ url, size }: { url: string | null; size: number }) {
  return url ? (
    <img src={url} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: size / 2, objectFit: "cover", flexShrink: 0 }} />
  ) : (
    <div aria-hidden="true" style={{ width: size, height: size, borderRadius: size / 2, background: "#3A3A3C", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
      </svg>
    </div>
  );
}

function DistanceChip({ t, person }: { t: Theme; person: RadarPerson }) {
  const label = person.bucket ? BUCKET_LABEL[person.bucket] : "Nearby";
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: t.raised, color: person.faded ? t.muted : t.text, whiteSpace: "nowrap" }}>
      {person.faded ? `${label} · moving away` : label}
    </span>
  );
}

function ConnectButton({ t, status, onConnect, onCancel, wide }: { t: Theme; status?: string; onConnect: () => void; onCancel?: () => void; wide?: boolean }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const style = { ...btn(t, status ? "ghost" : "primary"), ...(wide ? { width: "100%", maxWidth: 320 } : {}) };
  if (status === "accepted") return <button style={style} disabled className="nq-pop"><I.Check size={15} strokeWidth={2.4} style={{ marginRight: 4, verticalAlign: "-3px" }} />Connected</button>;
  if (status === "declined") return <button style={style} disabled>Not available</button>;
  if (status === "pending")
    return (
      <button
        style={style}
        onClick={() => (confirmCancel ? (setConfirmCancel(false), onCancel?.()) : setConfirmCancel(true))}
        onBlur={() => setConfirmCancel(false)}
        aria-label={confirmCancel ? "Confirm cancel request" : "Requested — tap to cancel"}
      >
        {confirmCancel ? "Cancel request?" : "Requested"}
      </button>
    );
  return (
    <button style={style} onClick={onConnect}>
      Connect
    </button>
  );
}

function ConfirmLink({ t, label, confirmLabel, ariaLabel, onConfirm }: { t: Theme; label: string; confirmLabel: string; ariaLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      onBlur={() => setArmed(false)}
      aria-label={armed ? `Confirm: ${ariaLabel}` : ariaLabel}
      style={{ minHeight: 44, padding: "0 16px", borderRadius: 22, border: `1px solid ${armed ? "#FF453A" : "rgba(255,69,58,0.35)"}`, background: armed ? "#FF453A" : "transparent", color: armed ? "#FFFFFF" : "#FF453A", fontSize: 14, fontWeight: 600, cursor: "pointer", flexShrink: 0, alignSelf: "center", transition: "background 0.15s ease, color 0.15s ease" }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

function NoEvent({
  t,
  card,
  busy,
  compact,
  onJoin,
  onCreate,
  onOpenEventsHub,
}: {
  t: Theme;
  card: React.CSSProperties;
  busy: boolean;
  compact?: boolean;
  onJoin: (code: string) => void;
  onCreate: (name: string, venue: string) => void;
  onOpenEventsHub?: () => void;
}) {
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const input: React.CSSProperties = {
    minHeight: 44,
    padding: "10px 14px",
    borderRadius: 12,
    border: `1px solid ${t.border}`,
    background: t.raised,
    color: t.text,
    fontSize: 16,
    width: "100%",
    boxSizing: "border-box",
  };
  return (
    <section style={card}>
      {!compact && (
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div aria-hidden style={{ width: 64, height: 64, borderRadius: 32, margin: "4px auto 14px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(124,58,237,0.1)", color: "#7C3AED" }}>
            <I.Target size={30} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>Event Radar</div>
          <div style={{ color: t.muted, fontSize: 15, marginTop: 6, maxWidth: 460, marginInline: "auto" }}>
            See who's around you at an event, with approximate distance. You choose who gets your contact details.
          </div>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onJoin(code);
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        <input
          aria-label="Event code"
          placeholder="Event code, e.g. NQ-7K3P9X"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          style={{ ...input, flex: "100 1 200px", letterSpacing: "0.06em" }}
        />
        {/* Grows to full width when it wraps under the field on narrow phones */}
        <button type="submit" style={{ ...btn(t, "primary"), flex: "1 0 120px" }} disabled={busy || !code.trim()}>
          {busy ? "Joining…" : "Join event"}
        </button>
      </form>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0", color: t.muted, fontSize: 12, fontWeight: 600 }}>
        <div style={{ flex: 1, height: 1, background: t.border }} /> OR <div style={{ flex: 1, height: 1, background: t.border }} />
      </div>

      {creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) onCreate(name.trim(), venue.trim());
          }}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <input aria-label="Event name" placeholder="Event name" value={name} onChange={(e) => setName(e.target.value)} style={input} maxLength={120} />
          <input aria-label="Venue" placeholder="Venue (optional)" value={venue} onChange={(e) => setVenue(e.target.value)} style={input} maxLength={160} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={{ ...btn(t, "ghost"), flex: 1 }} onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" style={{ ...btn(t, "primary"), flex: 2 }} disabled={busy || name.trim().length < 2}>
              Create & get code
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...btn(t, "ghost"), flex: "1 1 160px" }} onClick={() => setCreating(true)}>
            Create event
          </button>
          {onOpenEventsHub && (
            <button style={{ ...btn(t, "ghost"), flex: "1 1 160px" }} onClick={onOpenEventsHub}>
              Browse events
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function EventHeader({
  t,
  card,
  event,
  events,
  onSwitch,
  onShare,
  onLeave,
  onAddEvent,
  onOpenRoomChat,
}: {
  t: Theme;
  card: React.CSSProperties;
  event: RadarEvent;
  events: RadarEvent[];
  onSwitch: (id: string) => void;
  onShare: () => void;
  onLeave: () => void;
  onAddEvent: () => void;
  onOpenRoomChat?: () => void;
}) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  return (
    <section style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: PURPLE, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Live at</div>
          {events.length > 1 ? (
            <select
              aria-label="Switch event"
              value={event.id}
              onChange={(e) => (e.target.value === "__new__" ? onAddEvent() : onSwitch(e.target.value))}
              style={{ fontSize: 20, fontWeight: 700, background: "transparent", color: t.text, border: "none", padding: 0, maxWidth: "100%" }}
            >
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
              <option value="__new__">+ Join another event</option>
            </select>
          ) : (
            <div style={{ fontSize: 20, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.name}</div>
          )}
          <div style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>
            {[event.venue, event.attendee_count ? `${event.attendee_count} joined` : null].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button
          style={{ ...btn(t, "danger"), minHeight: 36, padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap", flex: "none" }}
          onClick={() => (confirmLeave ? onLeave() : setConfirmLeave(true))}
          onBlur={() => setConfirmLeave(false)}
          aria-label={confirmLeave ? "Confirm leave event" : "Leave event"}
        >
          {confirmLeave ? "Tap to confirm" : "Leave"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {onOpenRoomChat && (
          <button
            style={{ ...btn(t, "primary"), flex: 1, minWidth: 0, fontSize: 13 }}
            onClick={onOpenRoomChat}
            aria-label="Open Event Room Chat"
          >
            <I.Mail size={15} /> Room chat
          </button>
        )}
        {event.join_code && (
          <button style={{ ...btn(t, "ghost"), flex: 1, minWidth: 0 }} onClick={onShare} aria-label={`Share event code ${event.join_code}`}>
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.04em" }}>{event.join_code}</span>
            <span aria-hidden="true">· Share</span>
          </button>
        )}
        {events.length === 1 && (
          <button style={{ ...btn(t, "ghost"), whiteSpace: "nowrap" }} onClick={onAddEvent}>
            + Event
          </button>
        )}
      </div>
    </section>
  );
}

const STATUS_COPY: Partial<Record<RadarStatus, { title: string; body: string; action?: "bluetooth" | "retry" }>> = {
  starting: { title: "Starting Radar…", body: "Allow Nearby devices when your phone asks, so attendees can find each other." },
  bluetooth_off: { title: "Bluetooth is off", body: "Radar uses Bluetooth to find attendees near you.", action: "bluetooth" },
  permission_denied: { title: "Nearby devices permission needed", body: "Radar can't scan without it. Your location is never used or shared.", action: "retry" },
  permission_blocked: { title: "Permission blocked", body: "Enable Nearby devices for NetworQ in Settings to use Radar.", action: "bluetooth" },
  unsupported: { title: "Live distance isn't available on this device", body: "You can still see who's at this event below." },
  scan_only: { title: "You can see others, but they can't see you", body: "This phone can't broadcast over Bluetooth. Others will find you once they're close and visible." },
  offline: { title: "You're offline", body: "Showing the last people seen. Radar resumes when you reconnect." },
};

function StatusBanner({ t, status, mode, nearby, onBluetooth, onRetry }: { t: Theme; status: RadarStatus; mode: "native" | "web"; nearby?: boolean; onBluetooth: () => void; onRetry: () => void }) {
  if (mode === "web" && status === "scanning") {
    if (nearby) return null; // the Nearby list says it once
    return (
      <div role="status" style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 16, padding: "12px 16px", fontSize: 14 }}>
        <strong>Live distance works in the NetworQ Android app.</strong> <span style={{ color: t.muted }}>Here you can see who's at the event and connect.</span>
      </div>
    );
  }
  const copy = STATUS_COPY[status];
  if (!copy) return null;
  return (
    <div role="status" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: "12px 16px" }}>
      <div style={{ flex: "1 1 240px" }}>
        <div style={{ fontWeight: 600 }}>{copy.title}</div>
        <div style={{ color: t.muted, fontSize: 13 }}>{copy.body}</div>
      </div>
      {copy.action === "bluetooth" && (
        <button style={btn(t, "primary")} onClick={onBluetooth}>
          {status === "permission_blocked" ? "Open Settings" : "Turn on Bluetooth"}
        </button>
      )}
      {copy.action === "retry" && (
        <button style={btn(t, "primary")} onClick={onRetry}>
          Allow access
        </button>
      )}
    </div>
  );
}

function NearbyList({
  t,
  card,
  people,
  outgoing,
  onSelect,
  onConnect,
  onCancel,
  mode,
  nearbyScope,
}: {
  t: Theme;
  card: React.CSSProperties;
  people: RadarPerson[];
  outgoing: Map<string, string>;
  onSelect: (id: string) => void;
  onConnect: (id: string) => void;
  onCancel: (id: string) => void;
  mode: "native" | "web";
  nearbyScope?: boolean;
}) {
  return (
    <section style={card}>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{mode === "native" || nearbyScope ? "Nearby" : "At this event"} · {people.length}</h3>
      {people.length === 0 ? (
        <div style={{ color: t.muted, fontSize: 14, padding: "8px 0" }}>
          {mode === "native"
            ? nearbyScope
              ? "Looking for NetworQ people around you… They need Nearby on and Discoverable."
              : "Looking for attendees… Ask people near you to open Radar in NetworQ."
            : nearbyScope
              ? "Finding people around you uses Bluetooth, so it works in the NetworQ phone app. Open NetworQ on your phone to see who's nearby."
              : "No one else is active yet. Share the event code to invite people."}
        </div>
      ) : (
        <ul aria-label="Nearby attendees" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {people.map((p) => (
            <li key={p.userId} className="nq-pop" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", opacity: p.faded ? 0.55 : 1, transition: "opacity 0.4s ease" }}>
              <button
                onClick={() => onSelect(p.userId)}
                style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer", textAlign: "left" }}
                aria-label={`View ${p.name}`}
              >
                <Avatar url={p.avatar} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ color: t.muted, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[p.title, p.company].filter(Boolean).join(" · ") || "Attendee"}
                  </div>
                </div>
              </button>
              {mode === "native" && <DistanceChip t={t} person={p} />}
              <ConnectButton t={t} status={outgoing.get(p.userId)} onConnect={() => onConnect(p.userId)} onCancel={() => onCancel(p.userId)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Switch({ t, label, hint, checked, onChange, disabled }: { t: Theme; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", opacity: disabled ? 0.45 : 1 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{label}</div>
        <div style={{ color: t.muted, fontSize: 13 }}>{hint}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{ width: 52, height: 32, minWidth: 52, borderRadius: 16, border: "none", padding: 2, cursor: disabled ? "default" : "pointer", background: checked ? PURPLE : t.raised, boxShadow: `inset 0 0 0 1px ${t.border}`, transition: "background 0.2s" }}
      >
        <span style={{ display: "block", width: 28, height: 28, borderRadius: 14, background: "#FFFFFF", transform: `translateX(${checked ? 20 : 0}px)`, transition: "transform 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
      </button>
    </div>
  );
}

function PrivacyPanel({ t, card, settings, onChange, nearby }: { t: Theme; card: React.CSSProperties; settings: RadarSettings; onChange: (p: Partial<RadarSettings>) => void; nearby?: boolean }) {
  return (
    <section style={card} aria-label="Radar privacy">
      <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>Privacy</h3>
      {!nearby && (
        <>
          <Switch t={t} label="Radar" hint="Discover attendees around you at this event." checked={settings.radar_on} onChange={(v) => onChange({ radar_on: v })} />
          <Switch t={t} label="Visible to nearby attendees" hint="Off = incognito. You'll only see how many people are near." checked={settings.visible} onChange={(v) => onChange({ visible: v })} disabled={!settings.radar_on} />
        </>
      )}
      <Switch t={t} label="Show distance" hint="Let others see roughly how far away you are." checked={settings.show_distance} onChange={(v) => onChange({ show_distance: v })} disabled={!settings.radar_on || !settings.visible} />
      <Switch t={t} label="Show profile" hint="Off shows only your first name and title." checked={settings.show_profile} onChange={(v) => onChange({ show_profile: v })} disabled={!settings.radar_on || !settings.visible} />
      <p style={{ color: t.muted, fontSize: 12, margin: "8px 0 0" }}>
        Your phone broadcasts a random ID that changes every 15 minutes. Your location is never collected.
      </p>
    </section>
  );
}

function Sheet({ t, title, onClose, children }: { t: Theme; title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} className="nq-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "max(16px, calc(var(--safe-top, 0px) + 12px)) max(16px, calc(var(--safe-right, 0px) + 12px)) max(16px, calc(var(--safe-bottom, 0px) + 12px)) max(16px, calc(var(--safe-left, 0px) + 12px))", boxSizing: "border-box" }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="nq-sheet-up"
        onClick={(e) => e.stopPropagation()}
        style={{ background: t.surface, color: t.text, borderRadius: 24, padding: 20, width: "100%", maxWidth: 440, maxHeight: "min(85dvh, calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px))", overflowY: "auto", marginBottom: "calc(var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 12px)" }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button aria-label="Close" onClick={onClose} style={{ width: 44, height: 44, borderRadius: 22, border: "none", background: t.raised, color: t.text, fontSize: 20, cursor: "pointer" }}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ShareSheet({ t, event, onClose, showToast }: { t: Theme; event: RadarEvent; onClose: () => void; showToast: (m: string, type?: "success" | "error" | "info") => void }) {
  const link = `${typeof window !== "undefined" ? window.location.origin : "https://www.networq.co.in"}/?join=${encodeURIComponent(event.join_code || "")}`;
  const [qr, setQr] = useState("");
  useEffect(() => {
    QRCode.toDataURL(link, { width: 320, margin: 1 }).then(setQr).catch(() => setQr(""));
  }, [link]);
  return (
    <Sheet t={t} title="Share event" onClose={onClose}>
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{event.name}</div>
        <div style={{ background: "#FFFFFF", padding: 12, borderRadius: 16 }}>
          {qr ? <img src={qr} alt={`QR code to join ${event.name}`} width={220} height={220} /> : <div style={{ width: 220, height: 220 }} />}
        </div>
        <div style={{ color: t.muted, fontSize: 13 }}>Scan with a phone camera, or enter the code in Radar</div>
        <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 28, fontWeight: 700, letterSpacing: "0.08em" }}>{event.join_code}</div>
        <button
          style={{ ...btn(t, "primary"), width: "100%" }}
          onClick={async () => {
            try {
              if (navigator.share) await navigator.share({ title: event.name, text: `Join ${event.name} on NetworQ Radar`, url: link });
              else {
                await navigator.clipboard.writeText(link);
                showToast("Invite link copied", "success");
              }
            } catch {
              /* share sheet dismissed */
            }
          }}
        >
          Share invite link
        </button>
      </div>
    </Sheet>
  );
}
