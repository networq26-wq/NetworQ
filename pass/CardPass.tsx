// The NetworQ card: a minimal, credit-card-proportioned identity (ISO/IEC 7810 ID-1, 85.6 × 53.98 mm).
// Front = who you are. Tap to flip = a QR any phone camera saves as a contact.
// Customisation (finish, details shown, context mode) lives in Me → Card, not on the card.
import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { buildVCard, type PassProfile } from "./vcard";
import { I } from "../ui/icons";

export const CARD_FINISHES = [
  { id: "midnight", name: "Midnight", bg: "linear-gradient(135deg, #15131C 0%, #232030 55%, #2E2A3D 100%)", fg: "#FFFFFF", sub: "rgba(255,255,255,0.62)", accent: "#C4B5FD" },
  { id: "violet", name: "Violet", bg: "linear-gradient(135deg, #3B1A7A 0%, #6D28D9 60%, #8B5CF6 100%)", fg: "#FFFFFF", sub: "rgba(255,255,255,0.72)", accent: "#EDE9FE" },
  { id: "graphite", name: "Graphite", bg: "linear-gradient(135deg, #2C2C2E 0%, #48484A 60%, #636366 100%)", fg: "#FFFFFF", sub: "rgba(255,255,255,0.7)", accent: "#E5E5EA" },
  { id: "pearl", name: "Pearl", bg: "linear-gradient(135deg, #FFFFFF 0%, #F4F1FB 60%, #E9E3F7 100%)", fg: "#1C1C1E", sub: "rgba(28,28,30,0.58)", accent: "#7C3AED" },
] as const;

export type PassMode = "normal" | "event" | "sales" | "speaker";
export interface PassPrefs {
  style: string;
  showEmail: boolean;
  showPhone: boolean;
  mode: PassMode;
  eventName: string;
  eventGoal: string;
  salesPitch: string;
  meetingUrl: string;
  speakerTopic: string;
}
const KEY = "networq.pass";
const DEFAULTS: PassPrefs = { style: "midnight", showEmail: true, showPhone: true, mode: "normal", eventName: "", eventGoal: "", salesPitch: "", meetingUrl: "", speakerTopic: "" };

function read(): PassPrefs {
  try {
    const p = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    if (!CARD_FINISHES.some((f) => f.id === p.style)) p.style = DEFAULTS.style;
    return p;
  } catch {
    return DEFAULTS;
  }
}

// Shared between the card on Me and Me → Card settings (same tab stays in sync)
export function usePassPrefs(): [PassPrefs, (patch: Partial<PassPrefs>) => void] {
  const [prefs, setPrefs] = useState<PassPrefs>(read);
  useEffect(() => {
    const sync = () => setPrefs(read());
    window.addEventListener("networq-pass", sync);
    return () => window.removeEventListener("networq-pass", sync);
  }, []);
  const update = (patch: Partial<PassPrefs>) => {
    const next = { ...read(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    setPrefs(next);
    window.dispatchEvent(new Event("networq-pass"));
  };
  return [prefs, update];
}

type User = { name?: string; role?: string; company?: string; email?: string; phone?: string; linkedin?: string; website?: string; avatar_url?: string };

export function passVCard(user: User, p: PassPrefs): string {
  const note =
    p.mode === "event" && (p.eventName || p.eventGoal)
      ? [p.eventName && `At ${p.eventName}`, p.eventGoal && `Looking for ${p.eventGoal}`].filter(Boolean).join(" · ")
      : p.mode === "sales" && p.salesPitch
        ? `Offering ${p.salesPitch}`
        : p.mode === "speaker" && p.speakerTopic
          ? `Speaking on ${p.speakerTopic}`
          : "";
  const profile: PassProfile = {
    name: user?.name || "",
    title: user?.role || "",
    company: user?.company || "",
    email: p.showEmail ? user?.email || "" : "",
    phone: p.showPhone ? user?.phone || "" : "",
    website: p.mode === "sales" && p.meetingUrl ? p.meetingUrl : user?.website || "",
    linkedin: user?.linkedin || "",
    note: note ? `${note} · via NetworQ` : "Connected via NetworQ",
  };
  return buildVCard(profile);
}

export function useQr(text: string, size = 480) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#FFFFFF" } })
      .then((u: string) => alive && setUrl(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [text, size]);
  return url;
}

export function CardPass({ user, prefs }: { user: User; prefs: PassPrefs }) {
  const f = CARD_FINISHES.find((x) => x.id === prefs.style) || CARD_FINISHES[0];
  const vcard = useMemo(() => passVCard(user, prefs), [user, prefs]);
  const qr = useQr(vcard);
  const [flipped, setFlipped] = useState(false);
  const [tilt, setTilt] = useState({ x: 50, y: 30, rx: 0, ry: 0 });
  const ref = useRef<HTMLButtonElement>(null);

  const move = (e: React.PointerEvent) => {
    if (!ref.current || (e.pointerType !== "mouse" && e.buttons === 0)) return;
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    setTilt({ x: x * 100, y: y * 100, rx: (0.5 - y) * 7, ry: (x - 0.5) * 9 });
  };
  const reset = () => setTilt({ x: 50, y: 30, rx: 0, ry: 0 });
  const context =
    prefs.mode === "event" ? prefs.eventName || "At an event" : prefs.mode === "speaker" ? "Speaker" : prefs.mode === "sales" ? "Open to business" : "";

  const face: React.CSSProperties = { position: "absolute", inset: 0, borderRadius: 20, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", overflow: "hidden" };
  return (
    <div style={{ perspective: 1200, width: "100%", maxWidth: 380, margin: "0 auto" }}>
      <button
        ref={ref}
        type="button"
        onClick={() => setFlipped((v) => !v)}
        onPointerMove={move}
        onPointerLeave={reset}
        onPointerUp={(e) => e.pointerType !== "mouse" && reset()}
        aria-label={flipped ? "Your contact QR code. Tap to see your card" : "Your NetworQ card. Tap to show the QR code"}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "block",
          position: "relative",
          width: "100%",
          aspectRatio: "85.6 / 53.98",
          transformStyle: "preserve-3d",
          transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry + (flipped ? 180 : 0)}deg)`,
          transition: "transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1)",
          borderRadius: 20,
          boxShadow: "0 22px 44px -18px rgba(30, 16, 70, 0.55), 0 2px 6px rgba(0,0,0,0.12)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {/* Front */}
        <div style={{ ...face, background: f.bg, color: f.fg, padding: "7% 7.5%", boxSizing: "border-box", display: "flex", flexDirection: "column", border: f.id === "pearl" ? "1px solid rgba(0,0,0,0.06)" : "none" }}>
          <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(circle at ${tilt.x}% ${tilt.y}%, rgba(255,255,255,0.2), transparent 55%)` }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
            {/* Official wordmark: white on dark finishes, full colour on Pearl */}
            <img src={f.id === "pearl" ? "/brand/networq-wordmark.png" : "/brand/networq-wordmark-white.png"} alt="NetworQ" draggable={false} style={{ height: 20, width: "auto", display: "block" }} />
            {/* Contactless-style mark: "tap / scan me" without words */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={f.sub} strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M8.5 16.5a6 6 0 0 0 0-9" />
              <path d="M12 19a10 10 0 0 0 0-14" />
              <path d="M15.5 21.5a14 14 0 0 0 0-19" />
            </svg>
          </div>
          {context && <div style={{ position: "relative", marginTop: 10, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: f.sub }}>{context}</div>}
          <div style={{ marginTop: "auto", position: "relative", textAlign: "left", display: "flex", alignItems: "center", gap: 14 }}>
            {/* Profile photo (initials until you add one) */}
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" draggable={false} style={{ width: 56, height: 56, borderRadius: 28, objectFit: "cover", flexShrink: 0, boxShadow: `0 0 0 2px ${f.id === "pearl" ? "#FFFFFF" : "rgba(255,255,255,0.85)"}, 0 6px 14px rgba(0,0,0,0.25)` }} />
            ) : (
              <span aria-hidden style={{ width: 56, height: 56, borderRadius: 28, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: f.id === "pearl" ? "#7C3AED" : "#FFFFFF", background: f.id === "pearl" ? "#EDE9FE" : "rgba(255,255,255,0.16)", boxShadow: `0 0 0 2px ${f.id === "pearl" ? "#FFFFFF" : "rgba(255,255,255,0.5)"}` }}>
                {(user?.name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "clamp(19px, 5.6vw, 24px)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name || "Your name"}</div>
              <div style={{ fontSize: 13, color: f.sub, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {[user?.role, user?.company].filter(Boolean).join(" · ") || "Add your role in Me → Profile"}
              </div>
            </div>
          </div>
        </div>
        {/* Back: QR */}
        <div style={{ ...face, transform: "rotateY(180deg)", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", gap: "6%", padding: "6%", boxSizing: "border-box", border: "1px solid rgba(0,0,0,0.06)" }}>
          {qr ? <img src={qr} alt="QR Code" style={{ height: "100%", aspectRatio: "1", display: "block" }} /> : <div style={{ height: "100%", aspectRatio: "1" }} />}
          <div style={{ color: "#1C1C1E", textAlign: "left", maxWidth: "40%" }}>
            <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>Scan to save</div>
            <div style={{ fontSize: 12, color: "#6E6E73", marginTop: 4, lineHeight: 1.35 }}>Any phone camera adds you as a contact.</div>
            <img src="/brand/networq-wordmark.png" alt="NetworQ" draggable={false} style={{ height: 14, width: "auto", display: "block", marginTop: 12, opacity: 0.9 }} />
          </div>
        </div>
      </button>
      <div style={{ textAlign: "center", fontSize: 12, color: "rgba(127,127,135,0.9)", marginTop: 10 }}>{flipped ? "Tap the card to flip back" : "Tap the card to show your QR"}</div>
    </div>
  );
}

// Full-screen QR for scanning in a crowd: big, high contrast, nothing else
export function QrSheet({ user, prefs, onClose }: { user: User; prefs: PassPrefs; onClose: () => void }) {
  const qr = useQr(useMemo(() => passVCard(user, prefs), [user, prefs]), 720);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Your QR code" className="nq-backdrop" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="nq-pop" onClick={(e) => e.stopPropagation()} style={{ background: "#FFFFFF", borderRadius: 28, padding: 24, width: "100%", maxWidth: 360, textAlign: "center", color: "#1C1C1E" }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{user?.name || "Your contact"}</div>
        <div style={{ fontSize: 14, color: "#6E6E73", marginTop: 2 }}>{[user?.role, user?.company].filter(Boolean).join(" · ")}</div>
        {qr && <img src={qr} alt="QR Code" style={{ width: "100%", aspectRatio: "1", display: "block", marginTop: 16 }} />}
        <div style={{ fontSize: 13, color: "#6E6E73", marginTop: 12 }}>Point a phone camera here to save your contact.</div>
        <button onClick={onClose} style={{ marginTop: 16, width: "100%", minHeight: 50, borderRadius: 14, border: "none", background: "#F2F2F7", color: "#1C1C1E", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
          Done
        </button>
      </div>
    </div>
  );
}

// Me → Card: everything that used to crowd the pass
export function CardSettings({ user, isDark, onEditProfile, onWriteNfc }: { user: User; isDark: boolean; onEditProfile: () => void; onWriteNfc?: () => void }) {
  const [p, set] = usePassPrefs();
  const t = isDark ? { surface: "#1C1C1E", raised: "#2C2C2E", text: "#FFF", muted: "#AEAEB2", border: "rgba(255,255,255,0.1)" } : { surface: "#FFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", border: "rgba(0,0,0,0.08)" };
  const card: React.CSSProperties = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 20, padding: 16 };
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: t.muted, margin: "0 0 10px" };
  const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 14px", borderRadius: 12, border: `1px solid ${t.border}`, background: t.raised, color: t.text, fontSize: 16, marginTop: 8 };
  const toggle = (on: boolean, onChange: () => void, name: string, disabled?: boolean) => (
    <button role="switch" aria-checked={on && !disabled} aria-label={name} disabled={disabled} onClick={onChange} style={{ width: 52, minWidth: 52, height: 32, borderRadius: 16, border: "none", padding: 2, cursor: "pointer", opacity: disabled ? 0.45 : 1, background: on && !disabled ? "#7C3AED" : t.raised, boxShadow: `inset 0 0 0 1px ${t.border}` }}>
      <span style={{ display: "block", width: 28, height: 28, borderRadius: 14, background: "#FFF", transform: `translateX(${on && !disabled ? 20 : 0}px)`, transition: "transform 0.2s" }} />
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CardPass user={user} prefs={p} />
      <section style={card} aria-label="Card finish">
        <div style={label}>Finish</div>
        <div role="radiogroup" aria-label="Card finish" style={{ display: "flex", gap: 14 }}>
          {CARD_FINISHES.map((f) => (
            <button key={f.id} role="radio" aria-checked={p.style === f.id} aria-label={f.name} onClick={() => set({ style: f.id })} style={{ width: 44, height: 44, borderRadius: 22, background: f.bg, cursor: "pointer", border: f.id === "pearl" ? `1px solid ${t.border}` : "none", boxShadow: p.style === f.id ? `0 0 0 3px ${t.surface}, 0 0 0 5px #7C3AED` : "none" }} />
          ))}
        </div>
      </section>
      <section style={card} aria-label="Shared details">
        <div style={label}>Shared when someone scans your QR</div>
        <div style={{ display: "flex", alignItems: "center", padding: "6px 0" }}>
          <div style={{ flex: 1, fontSize: 16 }}>Email</div>
          {toggle(p.showEmail, () => set({ showEmail: !p.showEmail }), "Share email", !user?.email)}
        </div>
        <div style={{ display: "flex", alignItems: "center", padding: "6px 0" }}>
          <div style={{ flex: 1, fontSize: 16 }}>Phone{!user?.phone && <div style={{ fontSize: 12, color: t.muted }}>Add a phone number in Profile</div>}</div>
          {toggle(p.showPhone, () => set({ showPhone: !p.showPhone }), "Share phone", !user?.phone)}
        </div>
      </section>
      <section style={card} aria-label="Context">
        <div style={label}>Context (optional)</div>
        <div role="radiogroup" aria-label="Card context" style={{ display: "flex", padding: 3, borderRadius: 12, background: t.raised }}>
          {([["normal", "None"], ["event", "Event"], ["sales", "Business"], ["speaker", "Speaker"]] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={p.mode === k} onClick={() => set({ mode: k })} style={{ flex: 1, minHeight: 36, borderRadius: 9, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: p.mode === k ? t.surface : "transparent", color: p.mode === k ? t.text : t.muted, boxShadow: p.mode === k ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}>
              {l}
            </button>
          ))}
        </div>
        {p.mode === "event" && (
          <>
            <input aria-label="Event name" style={input} placeholder="Event name" value={p.eventName} onChange={(e) => set({ eventName: e.target.value })} />
            <input aria-label="Looking for" style={input} placeholder="Looking for (e.g. investors, designers)" value={p.eventGoal} onChange={(e) => set({ eventGoal: e.target.value })} />
          </>
        )}
        {p.mode === "sales" && (
          <>
            <input aria-label="What you offer" style={input} placeholder="What you offer" value={p.salesPitch} onChange={(e) => set({ salesPitch: e.target.value })} />
            <input aria-label="Booking link" style={input} placeholder="Booking link (optional)" inputMode="url" value={p.meetingUrl} onChange={(e) => set({ meetingUrl: e.target.value })} />
          </>
        )}
        {p.mode === "speaker" && <input aria-label="Talk topic" style={input} placeholder="Your talk topic" value={p.speakerTopic} onChange={(e) => set({ speakerTopic: e.target.value })} />}
        <div style={{ fontSize: 12, color: t.muted, marginTop: 10, lineHeight: 1.45 }}>Shown on your card and added to the contact people save from your QR.</div>
      </section>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={onEditProfile} style={{ flex: 1, minHeight: 48, borderRadius: 14, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
          Edit name & role
        </button>
        {onWriteNfc && (
          <button onClick={onWriteNfc} style={{ flex: 1, minHeight: 48, borderRadius: 14, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 15, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <I.Contact size={16} /> Write NFC card
          </button>
        )}
      </div>
    </div>
  );
}
