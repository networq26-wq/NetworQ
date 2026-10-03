// Digital Pass: an Apple Wallet–style card with a vCard QR any phone camera can save.
import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { buildVCard, type PassProfile } from "./vcard";

const PURPLE = "#7C3AED";
const STYLES = [
  { id: "violet", name: "Violet", bg: "linear-gradient(160deg, #4C1D95 0%, #7C3AED 55%, #A78BFA 100%)", fg: "#FFFFFF", sub: "rgba(255,255,255,0.72)" },
  { id: "midnight", name: "Midnight", bg: "linear-gradient(160deg, #0B0B0F 0%, #1C1C24 60%, #2E2A3D 100%)", fg: "#FFFFFF", sub: "rgba(255,255,255,0.62)" },
  { id: "graphite", name: "Graphite", bg: "linear-gradient(160deg, #3A3A3C 0%, #5A5A5E 60%, #8E8E93 100%)", fg: "#FFFFFF", sub: "rgba(255,255,255,0.7)" },
  { id: "pearl", name: "Pearl", bg: "linear-gradient(160deg, #FFFFFF 0%, #F2EEFB 60%, #E4DCF7 100%)", fg: "#1C1C1E", sub: "rgba(28,28,30,0.6)" },
] as const;

const PREFS_KEY = "networq.pass";
function readPrefs(): { style?: string; showEmail?: boolean; showPhone?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function DigitalPass({
  user,
  isDark,
  showToast,
  onEditProfile,
}: {
  user: { name?: string; role?: string; company?: string; email?: string; phone?: string; linkedin?: string; avatar_url?: string };
  isDark: boolean;
  showToast: (m: string, t?: "success" | "error" | "info") => void;
  onEditProfile: () => void;
}) {
  const prefs = useMemo(readPrefs, []);
  const [styleId, setStyleId] = useState(prefs.style || "violet");
  const [showEmail, setShowEmail] = useState(prefs.showEmail ?? true);
  const [showPhone, setShowPhone] = useState(prefs.showPhone ?? true);
  const [qr, setQr] = useState("");
  const [shine, setShine] = useState({ x: 50, y: 30, rx: 0, ry: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const st = STYLES.find((s) => s.id === styleId) || STYLES[0];

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ style: styleId, showEmail, showPhone }));
    } catch {}
  }, [styleId, showEmail, showPhone]);

  const profile: PassProfile = {
    name: user?.name || "",
    title: user?.role || "",
    company: user?.company || "",
    email: showEmail ? user?.email || "" : "",
    phone: showPhone ? user?.phone || "" : "",
    linkedin: user?.linkedin || "",
  };
  const vcard = buildVCard(profile);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(vcard, { width: 420, margin: 1, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#FFFFFF" } })
      .then((url: string) => alive && setQr(url))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [vcard]);

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    setShine({ x: x * 100, y: y * 100, rx: (0.5 - y) * 8, ry: (x - 0.5) * 8 });
  };

  const fileName = `${(profile.name || "contact").toLowerCase().replace(/[^a-z0-9]+/g, "_")}.vcf`;
  const saveVcf = () => {
    const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const share = async () => {
    const file = new File([vcard], fileName, { type: "text/vcard" });
    try {
      if ((navigator as any).canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: profile.name });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: profile.name, text: [profile.name, [profile.title, profile.company].filter(Boolean).join(", "), profile.email, profile.phone, profile.linkedin].filter(Boolean).join("\n") });
        return;
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
    }
    saveVcf();
    showToast("Sharing isn't available here, so we saved your contact card instead.", "info");
  };

  const initials = (profile.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const muted = isDark ? "#AEAEB2" : "#6E6E73";
  const surface = isDark ? "#1C1C1E" : "#FFFFFF";
  const border = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";
  const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: st.sub };
  const action: React.CSSProperties = { flex: 1, minHeight: 48, borderRadius: 14, border: `1px solid ${border}`, background: surface, color: isDark ? "#FFF" : "#1C1C1E", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 28, letterSpacing: "-0.02em" }}>Digital Pass</h2>
        <p style={{ margin: "4px 0 0", color: muted, fontSize: 14 }}>Show the QR — any phone camera can save your contact.</p>
      </div>

      {!profile.name && (
        <div role="alert" style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(124,58,237,0.1)", fontSize: 14 }}>
          Add your name in Settings so people know whose pass this is.{" "}
          <button onClick={onEditProfile} style={{ border: "none", background: "none", color: PURPLE, fontWeight: 600, cursor: "pointer", padding: 0 }}>Edit profile</button>
        </div>
      )}

      {/* The pass */}
      <div style={{ perspective: 1000 }}>
        <div
          ref={cardRef}
          aria-label="Your digital pass"
          onPointerMove={onMove}
          onPointerLeave={() => setShine({ x: 50, y: 30, rx: 0, ry: 0 })}
          style={{
            position: "relative",
            borderRadius: 24,
            background: st.bg,
            color: st.fg,
            padding: 22,
            overflow: "hidden",
            boxShadow: "0 24px 48px -16px rgba(40, 20, 90, 0.45), 0 2px 6px rgba(0,0,0,0.12)",
            transform: `rotateX(${shine.rx}deg) rotateY(${shine.ry}deg)`,
            transition: "transform 120ms ease-out",
            border: st.id === "pearl" ? "1px solid rgba(0,0,0,0.06)" : "none",
          }}
        >
          <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(circle at ${shine.x}% ${shine.y}%, rgba(255,255,255,0.22), transparent 55%)` }} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em" }}>
              Networ<span style={{ color: st.id === "pearl" ? PURPLE : "#C4B5FD" }}>Q</span>
            </span>
            <span style={label}>Member pass</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22, position: "relative" }}>
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" width={56} height={56} style={{ borderRadius: 28, objectFit: "cover", border: `2px solid ${st.sub}` }} />
            ) : (
              <div aria-hidden style={{ width: 56, height: 56, borderRadius: 28, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 20, background: st.id === "pearl" ? "rgba(124,58,237,0.12)" : "rgba(255,255,255,0.18)" }}>
                {initials}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, overflowWrap: "anywhere" }}>{profile.name || "Your name"}</div>
              <div style={{ fontSize: 14, color: st.sub, marginTop: 3 }}>{[profile.title, profile.company].filter(Boolean).join(" · ") || "Add your role in Settings"}</div>
            </div>
          </div>

          {(profile.email || profile.phone) && (
            <div style={{ display: "grid", gridTemplateColumns: profile.email && profile.phone ? "1.4fr 1fr" : "1fr", gap: 12, marginTop: 20, position: "relative" }}>
              {profile.email && (
                <div style={{ minWidth: 0 }}>
                  <div style={label}>Email</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.email}</div>
                </div>
              )}
              {profile.phone && (
                <div style={{ minWidth: 0 }}>
                  <div style={label}>Phone</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3, whiteSpace: "nowrap" }}>{profile.phone}</div>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 22, background: "#FFFFFF", borderRadius: 18, padding: 14, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
            {qr ? (
              <img src={qr} alt="QR Code" width={196} height={196} style={{ display: "block", width: 196, height: 196 }} />
            ) : (
              <div style={{ width: 196, height: 196 }} aria-busy="true" />
            )}
            <div style={{ fontSize: 12, color: "#6E6E73", marginTop: 6, fontWeight: 500 }}>Scan to save contact</div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <button style={{ ...action, background: PURPLE, borderColor: PURPLE, color: "#FFF" }} onClick={share}>Share</button>
        <button style={action} onClick={saveVcf} aria-label="Save contact card (.vcf)">Save .vcf</button>
      </div>

      {/* Customise */}
      <section style={{ background: surface, border: `1px solid ${border}`, borderRadius: 18, padding: 16 }} aria-label="Customise pass">
        <div style={{ fontSize: 13, fontWeight: 700, color: muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Style</div>
        <div role="radiogroup" aria-label="Pass style" style={{ display: "flex", gap: 12, marginTop: 10 }}>
          {STYLES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={styleId === s.id}
              aria-label={s.name}
              onClick={() => setStyleId(s.id)}
              style={{ width: 40, height: 40, borderRadius: 20, background: s.bg, cursor: "pointer", border: s.id === "pearl" ? `1px solid ${border}` : "none", boxShadow: styleId === s.id ? `0 0 0 3px ${surface}, 0 0 0 5px ${PURPLE}` : "none" }}
            />
          ))}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: muted, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 18 }}>On your pass</div>
        <Toggle label="Email" checked={showEmail} onChange={setShowEmail} isDark={isDark} disabled={!user?.email} />
        <Toggle label="Phone" checked={showPhone} onChange={setShowPhone} isDark={isDark} disabled={!user?.phone} hint={!user?.phone ? "Add a phone number in Settings" : undefined} />
        <button onClick={onEditProfile} style={{ marginTop: 8, border: "none", background: "none", color: PURPLE, fontWeight: 600, fontSize: 15, cursor: "pointer", padding: "8px 0" }}>
          Edit name, role and photo
        </button>
      </section>

      <p style={{ color: muted, fontSize: 12, textAlign: "center", margin: 0, lineHeight: 1.5 }}>
        Tip: turn your screen brightness up when someone scans it. Apple Wallet and Google Wallet passes need a signed issuer account, so the pass lives here in NetworQ.
      </p>
    </div>
  );
}

function Toggle({ label, checked, onChange, isDark, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; isDark: boolean; disabled?: boolean; hint?: string }) {
  const on = checked && !disabled;
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "10px 0", opacity: disabled ? 0.5 : 1 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: isDark ? "#AEAEB2" : "#6E6E73" }}>{hint}</div>}
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={`Show ${label.toLowerCase()} on pass`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{ width: 52, minWidth: 52, height: 32, borderRadius: 16, border: "none", padding: 2, cursor: disabled ? "default" : "pointer", background: on ? PURPLE : isDark ? "#3A3A3C" : "#E5E5EA" }}
      >
        <span style={{ display: "block", width: 28, height: 28, borderRadius: 14, background: "#FFF", transform: `translateX(${on ? 20 : 0}px)`, transition: "transform 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
      </button>
    </div>
  );
}
