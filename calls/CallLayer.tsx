// Calls that ring anywhere in the app. Mounted once (signed in). Any screen starts a call with
// placeCall(peer, kind); incoming calls arrive live (Realtime on `calls`) or from a push tap.
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CallSession } from "./CallSession";
import { MediaError } from "./media";

export type CallKind = "audio" | "video";
export type CallPeer = { id: string; name: string; avatar_url?: string | null };
type Phase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";
type CallRow = { id: string; caller_id: string; callee_id: string; kind: CallKind; status: string; created_at: string };

const STUN: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
const RING_MS = 45_000;

/** Start a call from anywhere (chat header, contact sheet, …). */
export function placeCall(peer: CallPeer, kind: CallKind) {
  window.dispatchEvent(new CustomEvent("networq:call", { detail: { peer, kind } }));
}
/** Open a specific call (from a push / notification tap). */
export function openCall(callId: string) {
  window.dispatchEvent(new CustomEvent("networq:open-call", { detail: { callId } }));
}

const friendly = (e: any) => {
  const m = String(e?.message || "");
  if (/not_connected/.test(m)) return "You can only call people you're connected with.";
  if (/unavailable/.test(m)) return "This person can't be called.";
  if (/rate_limited/.test(m)) return "Too many calls in a short time. Please wait a few minutes.";
  if (e instanceof MediaError) return m;
  return m && m.length < 140 ? m : "Couldn't start the call. Please try again.";
};

// Gentle tones made in the browser (no audio files): ringtone for incoming, ringback for outgoing
function useTone(kind: "ring" | "ringback" | null) {
  useEffect(() => {
    if (!kind) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return;
    }
    const c = ctx;
    const beep = (at: number, freq: number, len: number, vol: number) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.02);
      g.gain.setValueAtTime(vol, at + len - 0.05);
      g.gain.linearRampToValueAtTime(0, at + len);
      o.connect(g).connect(c.destination);
      o.start(at);
      o.stop(at + len + 0.05);
    };
    const play = () => {
      const t = c.currentTime + 0.05;
      if (kind === "ring") {
        beep(t, 880, 0.35, 0.12);
        beep(t + 0.45, 660, 0.35, 0.12);
        try {
          navigator.vibrate?.([300, 150, 300]);
        } catch {}
      } else {
        beep(t, 440, 1.0, 0.05);
      }
    };
    play();
    const timer = setInterval(play, kind === "ring" ? 2000 : 3000);
    return () => {
      clearInterval(timer);
      try {
        navigator.vibrate?.(0);
      } catch {}
      c.close().catch(() => {});
    };
  }, [kind]);
}

function Video({ stream, muted, mirror, style }: { stream: MediaStream | null; muted?: boolean; mirror?: boolean; style: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} style={{ objectFit: "cover", background: "#000", transform: mirror ? "scaleX(-1)" : undefined, ...style }} />;
}

function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      ref.current.play?.().catch(() => {});
    }
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// Line icons (24px grid, 1.8 stroke) matching ui/icons
const Ico = {
  mic: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /></>,
  micOff: <><path d="m2 2 20 20" /><path d="M18.89 13.23A7 7 0 0 0 19 12v-2" /><path d="M5 10v2a7 7 0 0 0 12 5" /><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12" /><path d="M12 19v3" /></>,
  cam: <><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" /></>,
  camOff: <><path d="m2 2 20 20" /><path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8" /><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" /></>,
  flip: <><path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /><path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" /><circle cx="12" cy="12" r="3" /><path d="m18 22-3-3 3-3" /><path d="m6 2 3 3-3 3" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
};
const Svg = ({ d, size = 26, rotate }: { d: React.ReactNode; size?: number; rotate?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: rotate ? `rotate(${rotate}deg)` : undefined }}>
    {d}
  </svg>
);

function RoundButton({ label, onClick, tone = "glass", active, children, size = 64 }: { label: string; onClick: () => void; tone?: "glass" | "red" | "green"; active?: boolean; children: React.ReactNode; size?: number }) {
  const bg = tone === "red" ? "#FF3B30" : tone === "green" ? "#34C759" : active ? "#FFFFFF" : "rgba(255,255,255,0.16)";
  const fg = tone === "glass" && active ? "#1C1C1E" : "#FFFFFF";
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 72 }}>
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={tone === "glass" ? !!active : undefined}
        className="btn-press"
        style={{ width: size, height: size, borderRadius: size / 2, border: "none", background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", transition: "background 0.15s ease, color 0.15s ease" }}
      >
        {children}
      </button>
      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>{label}</span>
    </span>
  );
}

export function CallLayer({
  supabase,
  me,
  apiBaseUrl,
  showToast,
}: {
  supabase: SupabaseClient;
  me: { id: string; name?: string };
  apiBaseUrl: string;
  showToast: (m: string, t?: "success" | "error" | "info") => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [call, setCall] = useState<CallRow | null>(null);
  const [peer, setPeer] = useState<CallPeer | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [endText, setEndText] = useState("");
  const session = useRef<CallSession | null>(null);
  const startedRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const callRef = useRef<CallRow | null>(null);
  phaseRef.current = phase;
  callRef.current = call;

  const busy = phase !== "idle";
  useEffect(() => {
    (window as any).__networqCallBusy = busy && phase !== "ended";
  }, [busy, phase]);

  useTone(phase === "incoming" ? "ring" : phase === "outgoing" ? "ringback" : null);

  useEffect(() => {
    if (phase !== "active") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const iceServers = useCallback(async (): Promise<RTCIceServer[]> => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const base = apiBaseUrl.replace(/\/$/, "");
      const r = await fetch(`${base}/api/calls/ice`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) return STUN;
      const d = await r.json();
      return Array.isArray(d.iceServers) && d.iceServers.length ? d.iceServers : STUN;
    } catch {
      return STUN;
    }
  }, [supabase, apiBaseUrl]);

  const reset = useCallback(() => {
    session.current?.close(false);
    session.current = null;
    setPhase("idle");
    setCall(null);
    setPeer(null);
    setLocal(null);
    setRemote(null);
    setMuted(false);
    setCameraOff(false);
    setStartedAt(null);
    startedRef.current = null;
    setEndText("");
  }, []);

  // Show a short closing state ("Call ended · 3:12", "No answer", …), then go away
  const finish = useCallback(
    (text: string, notifyPeer: boolean) => {
      const c = callRef.current;
      session.current?.close(notifyPeer);
      session.current = null;
      if (c) supabase.rpc("end_call", { p_call_id: c.id }).then(() => {}, () => {});
      setLocal(null);
      setRemote(null);
      setEndText(text);
      setPhase("ended");
      setTimeout(() => phaseRef.current === "ended" && reset(), 1800);
    },
    [supabase, reset]
  );

  const durationText = () => (startedRef.current ? ` · ${mmss(Date.now() - startedRef.current)}` : "");

  const makeSession = useCallback(
    async (row: CallRow, role: "caller" | "callee", other: string) => {
      const s = new CallSession(supabase, { callId: row.id, me: me.id, peer: other, role, video: row.kind === "video", iceServers: await iceServers() }, {
        onLocalStream: (st) => setLocal(new MediaStream(st.getTracks())),
        onRemoteStream: (st) => setRemote(new MediaStream(st.getTracks())),
        onConnected: () => {
          startedRef.current = Date.now();
          setStartedAt(startedRef.current);
          setPhase("active");
        },
        onFailed: (m) => {
          showToast(m, "error");
          finish("Call ended", true);
        },
        onRemoteHangup: () => finish(`Call ended${durationText()}`, false),
      });
      session.current = s;
      await s.start();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, me.id, iceServers, finish, showToast]
  );

  // ── Outgoing ──
  const start = useCallback(
    async (to: CallPeer, kind: CallKind) => {
      if (phaseRef.current !== "idle") return showToast("You're already in a call.", "info");
      setPeer(to);
      setPhase("outgoing");
      try {
        const { data, error } = await supabase.rpc("start_call", { p_callee: to.id, p_kind: kind });
        if (error) throw new Error(error.message);
        const row = data as CallRow;
        setCall(row);
        callRef.current = row;
        await makeSession(row, "caller", to.id);
      } catch (e) {
        showToast(friendly(e), "error");
        finish("Call didn't start", false);
      }
    },
    [supabase, makeSession, finish, showToast]
  );

  // No answer after 45 s
  useEffect(() => {
    if (phase !== "outgoing" || !call) return;
    const t = setTimeout(() => finish("No answer", true), RING_MS - (Date.now() - new Date(call.created_at).getTime()));
    return () => clearTimeout(t);
  }, [phase, call, finish]);

  // ── Incoming ──
  const ring = useCallback(
    async (row: CallRow) => {
      if (row.callee_id !== me.id || row.status !== "ringing") return;
      if (Date.now() - new Date(row.created_at).getTime() > RING_MS) return;
      if (phaseRef.current !== "idle") return; // busy: they'll see a missed call
      const { data: n } = await supabase.from("notifications").select("title").eq("dedupe_key", `call:${row.id}`).maybeSingle();
      setPeer({ id: row.caller_id, name: (n as any)?.title || "NetworQ member" });
      setCall(row);
      setPhase("incoming");
    },
    [supabase, me.id]
  );

  useEffect(() => {
    if (phase !== "incoming" || !call) return;
    const t = setTimeout(() => reset(), Math.max(0, RING_MS - (Date.now() - new Date(call.created_at).getTime())));
    return () => clearTimeout(t);
  }, [phase, call, reset]);

  const accept = useCallback(async () => {
    const row = callRef.current;
    if (!row) return;
    setPhase("connecting");
    try {
      const { data, error } = await supabase.rpc("answer_call", { p_call_id: row.id, p_accept: true });
      if (error) throw new Error(error.message);
      if ((data as CallRow).status !== "accepted") return finish("Call ended", false);
      await makeSession(row, "callee", row.caller_id);
    } catch (e) {
      showToast(friendly(e), "error");
      finish("Call ended", true);
    }
  }, [supabase, makeSession, finish, showToast]);

  const decline = useCallback(() => {
    const row = callRef.current;
    if (row) supabase.rpc("answer_call", { p_call_id: row.id, p_accept: false }).then(() => {}, () => {});
    reset();
  }, [supabase, reset]);

  // Live status changes (accepted / declined / cancelled / ended) and new incoming calls
  useEffect(() => {
    const onRow = (row: CallRow, isInsert: boolean) => {
      if (isInsert) return ring(row);
      const cur = callRef.current;
      if (!cur || row.id !== cur.id) return;
      setCall(row);
      if (row.status === "accepted" && phaseRef.current === "outgoing") setPhase("connecting");
      if (row.status === "declined" && phaseRef.current === "outgoing") finish("Declined", false);
      if ((row.status === "cancelled" || row.status === "missed") && phaseRef.current === "incoming") reset();
      if (row.status === "ended" && (phaseRef.current === "active" || phaseRef.current === "connecting")) finish(`Call ended${durationText()}`, false);
    };
    const ch = supabase
      .channel(`calls:${me.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `callee_id=eq.${me.id}` }, (p: any) => onRow(p.new, p.eventType === "INSERT"))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: `caller_id=eq.${me.id}` }, (p: any) => onRow(p.new, false))
      .subscribe();
    // Opened from a push, or realtime missed it: pick up a call that's still ringing for me
    supabase
      .from("calls")
      .select("*")
      .eq("callee_id", me.id)
      .eq("status", "ringing")
      .gt("created_at", new Date(Date.now() - RING_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => data?.[0] && ring(data[0] as CallRow), () => {});
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, me.id]);

  useEffect(() => {
    const onPlace = (e: any) => start(e.detail.peer, e.detail.kind);
    const onOpen = async (e: any) => {
      const { data } = await supabase.from("calls").select("*").eq("id", e.detail.callId).maybeSingle();
      if (data) ring(data as CallRow);
      else showToast("That call has ended.", "info");
    };
    window.addEventListener("networq:call", onPlace);
    window.addEventListener("networq:open-call", onOpen);
    return () => {
      window.removeEventListener("networq:call", onPlace);
      window.removeEventListener("networq:open-call", onOpen);
    };
  }, [start, ring, supabase, showToast]);

  // Leaving the page ends the call properly
  useEffect(() => {
    const bye = () => {
      if (callRef.current && phaseRef.current !== "idle" && phaseRef.current !== "ended") {
        session.current?.close(true);
        supabase.rpc("end_call", { p_call_id: callRef.current.id }).then(() => {}, () => {});
      }
    };
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [supabase]);

  if (phase === "idle" || !peer) return null;

  const video = call?.kind === "video";
  const showVideo = video && (phase === "active" || phase === "connecting" || phase === "outgoing");
  const status =
    phase === "outgoing"
      ? call?.status === "accepted"
        ? "Connecting…"
        : "Ringing…"
      : phase === "incoming"
        ? video
          ? "Incoming video call"
          : "Incoming call"
        : phase === "connecting"
          ? "Connecting…"
          : phase === "active"
            ? startedAt
              ? mmss(now - startedAt)
              : ""
            : endText;
  const initial = (peer.name || "?").trim().charAt(0).toUpperCase();
  const hasRemoteVideo = !!remote && remote.getVideoTracks().length > 0;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Call with ${peer.name}`} className="nq-call" style={{ position: "fixed", inset: 0, zIndex: 10000 /* above every sheet and modal */, background: "linear-gradient(180deg, #1B1530 0%, #0B0B10 100%)", color: "#FFFFFF", display: "flex", flexDirection: "column" }}>
      <style>{`
        .nq-call { animation: nqCallIn 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) backwards; }
        @keyframes nqCallIn { from { opacity: 0; } to { opacity: 1; } }
        .nq-call-pulse { position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(167, 139, 250, 0.55); animation: nqCallPulse 2s ease-out infinite; }
        .nq-call-pulse.d2 { animation-delay: 1s; }
        @keyframes nqCallPulse { from { transform: scale(1); opacity: 0.9; } to { transform: scale(1.7); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .nq-call, .nq-call-pulse { animation: none !important; } }
      `}</style>
      {!video && <RemoteAudio stream={remote} />}

      {/* Remote video fills the screen once it arrives */}
      {showVideo && hasRemoteVideo && <Video stream={remote} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />}
      {/* Your own camera: full screen while ringing, small corner tile once connected */}
      {showVideo && local && local.getVideoTracks().length > 0 && !cameraOff && (
        <Video
          stream={local}
          muted
          mirror={session.current?.facing !== "environment"}
          style={
            hasRemoteVideo
              ? { position: "absolute", top: "calc(var(--safe-top, env(safe-area-inset-top, 0px)) + 16px)", right: 16, width: 108, height: 152, borderRadius: 18, zIndex: 2, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }
              : { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.55 }
          }
        />
      )}
      {showVideo && hasRemoteVideo && <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, transparent 22%, transparent 70%, rgba(0,0,0,0.6) 100%)", pointerEvents: "none" }} />}

      {/* Name + status */}
      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: hasRemoteVideo && showVideo ? "flex-start" : "center", padding: "calc(var(--safe-top, env(safe-area-inset-top, 0px)) + 24px) 24px 0", textAlign: "center" }}>
        {!(hasRemoteVideo && showVideo) && (
          <div style={{ position: "relative", width: 120, height: 120, marginBottom: 24 }}>
            {(phase === "incoming" || phase === "outgoing") && (
              <>
                <span className="nq-call-pulse" aria-hidden />
                <span className="nq-call-pulse d2" aria-hidden />
              </>
            )}
            {peer.avatar_url ? (
              <img src={peer.avatar_url} alt="" width={120} height={120} style={{ position: "relative", borderRadius: 60, objectFit: "cover" }} />
            ) : (
              <span aria-hidden style={{ position: "relative", width: 120, height: 120, borderRadius: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #7C3AED, #4F46E5)", fontSize: 48, fontWeight: 700 }}>
                {initial}
              </span>
            )}
          </div>
        )}
        <div style={{ fontSize: hasRemoteVideo && showVideo ? 20 : 30, fontWeight: 700, letterSpacing: "-0.02em", textShadow: showVideo ? "0 1px 8px rgba(0,0,0,0.5)" : undefined }}>{peer.name}</div>
        <div role="status" aria-live="polite" style={{ fontSize: 16, marginTop: 6, color: "rgba(255,255,255,0.75)", fontVariantNumeric: "tabular-nums" }}>
          {status}
        </div>
      </div>

      {/* Controls */}
      <div style={{ position: "relative", zIndex: 1, padding: "24px 16px calc(var(--safe-bottom, env(safe-area-inset-bottom, 0px)) + 32px)", display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap" }}>
        {phase === "incoming" ? (
          <>
            <RoundButton label="Decline" tone="red" onClick={decline} size={72}>
              <Svg d={Ico.phone} rotate={135} size={30} />
            </RoundButton>
            <RoundButton label="Accept" tone="green" onClick={accept} size={72}>
              {video ? <Svg d={Ico.cam} size={30} /> : <Svg d={Ico.phone} size={30} />}
            </RoundButton>
          </>
        ) : phase === "ended" ? null : (
          <>
            <RoundButton
              label={muted ? "Unmute" : "Mute"}
              active={muted}
              onClick={() => {
                session.current?.setMuted(!muted);
                setMuted(!muted);
              }}
            >
              <Svg d={muted ? Ico.micOff : Ico.mic} />
            </RoundButton>
            {video && (
              <RoundButton
                label={cameraOff ? "Camera on" : "Camera off"}
                active={cameraOff}
                onClick={() => {
                  session.current?.setCameraOff(!cameraOff);
                  setCameraOff(!cameraOff);
                }}
              >
                <Svg d={cameraOff ? Ico.camOff : Ico.cam} />
              </RoundButton>
            )}
            {video && (
              <RoundButton label="Flip" onClick={() => session.current?.flipCamera().catch(() => showToast("Couldn't switch camera.", "error"))}>
                <Svg d={Ico.flip} />
              </RoundButton>
            )}
            <RoundButton label="End" tone="red" onClick={() => finish(phase === "active" ? `Call ended${durationText()}` : "Call cancelled", true)}>
              <Svg d={Ico.phone} rotate={135} />
            </RoundButton>
          </>
        )}
      </div>
    </div>
  );
}
