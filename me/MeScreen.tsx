// Me: your card first, then settings grouped into a few plain-language categories.
// Each row opens its own page (one topic per page) — no long scrolling settings wall.
import React, { useState } from "react";
import { I } from "../ui/icons";
import { CardPass, QrSheet, usePassPrefs, passVCard } from "../pass/CardPass";
import type { SettingsSection } from "../settings/SettingsScreen";

type User = { id?: string; name?: string; role?: string; company?: string; email?: string; phone?: string; linkedin?: string; website?: string; avatar_url?: string };
type Row = { key: SettingsSection | "tool"; label: string; hint?: string; icon: (p: { size?: number }) => React.ReactElement; color: string; onClick?: () => void; danger?: boolean };

export const SECTION_TITLES: Record<SettingsSection, string> = {
  profile: "Profile",
  card: "Card",
  organization: "Your organization",
  followups: "Follow-up autopilot",
  notifications: "Notifications",
  privacy: "Privacy & blocking",
  security: "Password & devices",
  appearance: "Appearance",
  data: "Your data",
  help: "Help & about",
  account: "Account",
};

export function MeScreen({
  user,
  isDark,
  section,
  onOpenSection,
  renderSection,
  showToast,
  tools,
}: {
  user: User;
  isDark: boolean;
  section: SettingsSection | null;
  onOpenSection: (s: SettingsSection | null) => void;
  renderSection: (s: SettingsSection) => React.ReactNode;
  showToast: (m: string, t?: "success" | "error" | "info") => void;
  tools: { label: string; hint: string; icon: Row["icon"]; onClick: () => void }[];
}) {
  const [prefs] = usePassPrefs();
  const [qrOpen, setQrOpen] = useState(false);
  const t = isDark
    ? { surface: "#1C1C1E", raised: "#2C2C2E", text: "#FFFFFF", muted: "#AEAEB2", border: "rgba(255,255,255,0.08)", sep: "rgba(255,255,255,0.08)" }
    : { surface: "#FFFFFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", border: "rgba(0,0,0,0.06)", sep: "rgba(0,0,0,0.06)" };

  const share = async () => {
    const vcard = passVCard(user, prefs);
    const file = new File([vcard], `${(user.name || "contact").toLowerCase().replace(/[^a-z0-9]+/g, "_")}.vcf`, { type: "text/vcard" });
    try {
      if ((navigator as any).canShare?.({ files: [file] })) return void (await navigator.share({ files: [file], title: user.name }));
    } catch (e: any) {
      if (e?.name === "AbortError") return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("Saved your contact card.", "success");
  };

  if (section) {
    return (
      <div key={section} className="nq-sheet-right" style={{ maxWidth: 720 }}>
        <button onClick={() => onOpenSection(null)} aria-label="Back to Me" style={{ display: "inline-flex", alignItems: "center", gap: 2, border: "none", background: "none", color: "#7C3AED", fontSize: 17, fontWeight: 500, cursor: "pointer", padding: "8px 0", marginLeft: -6, minHeight: 44 }}>
          <I.ChevronLeft size={24} /> Me
        </button>
        <h2 style={{ margin: "2px 0 16px", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>{SECTION_TITLES[section]}</h2>
        {renderSection(section)}
      </div>
    );
  }

  const groups: { title?: string; rows: Row[] }[] = [
    {
      rows: [
        { key: "profile", label: "Profile", hint: "Name, role, photo", icon: I.User, color: "#7C3AED" },
        { key: "card", label: "Card", hint: "Finish and what you share", icon: I.Contact, color: "#5856D6" },
        { key: "organization", label: "Your organization", hint: "Used in AI emails", icon: I.Building, color: "#0A84FF" },
      ],
    },
    {
      rows: [{ key: "followups", label: "Follow-up autopilot", hint: "Sends your follow-ups for you", icon: I.Zap, color: "#7C3AED" }],
    },
    {
      rows: [
        { key: "notifications", label: "Notifications", icon: I.Bell, color: "#FF3B30" },
        { key: "privacy", label: "Privacy & blocking", icon: I.UserCheck, color: "#34C759" },
        { key: "security", label: "Password & devices", icon: I.Lock, color: "#8E8E93" },
        { key: "appearance", label: "Appearance", hint: "Dark mode, vibration", icon: I.Sparkles, color: "#FF9F0A" },
      ],
    },
    ...(tools.length ? [{ title: "Tools", rows: tools.map((x) => ({ key: "tool" as const, label: x.label, hint: x.hint, icon: x.icon, color: "#7C3AED", onClick: x.onClick })) }] : []),
    {
      rows: [
        { key: "data", label: "Your data", hint: "Export contacts", icon: I.ArrowRight, color: "#64D2FF" },
        { key: "help", label: "Help & about", icon: I.Globe, color: "#30B0C7" },
        { key: "account", label: "Account", hint: "Sign out, delete account", icon: I.User, color: "#8E8E93" },
      ],
    },
  ];

  return (
    <div className="nq-me">
      <h2 className="nq-me-title" style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>Me</h2>
      <div className="nq-me-col nq-me-left">
      <CardPass user={user} prefs={prefs} />
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => setQrOpen(true)} style={{ flex: 1, minHeight: 52, borderRadius: 16, border: "none", background: "#7C3AED", color: "#FFF", fontSize: 16, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <I.Contact size={18} /> Show QR
        </button>
        <button onClick={share} aria-label="Share card — send your contact card to WhatsApp, email or any app" style={{ flex: 1, minHeight: 52, borderRadius: 16, border: `1px solid ${t.border}`, background: t.surface, color: t.text, fontSize: 16, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <I.ArrowRight size={18} style={{ transform: "rotate(-45deg)" }} /> Share card
        </button>
      </div>
      </div>
      <div className="nq-me-col">

      {groups.map((g, gi) => (
        <section key={gi} aria-label={g.title || undefined}>
          {g.title && <div style={{ fontSize: 13, fontWeight: 600, color: t.muted, textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 8px 16px" }}>{g.title}</div>}
          <div style={{ background: t.surface, borderRadius: 18, border: `1px solid ${t.border}`, overflow: "hidden" }}>
            {g.rows.map((r, i) => (
              <button
                key={r.label}
                onClick={() => (r.onClick ? r.onClick() : onOpenSection(r.key as SettingsSection))}
                style={{ all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", minHeight: 56, cursor: "pointer", borderTop: i ? `1px solid ${t.sep}` : "none" }}
              >
                <span aria-hidden style={{ width: 32, height: 32, borderRadius: 9, background: r.color, color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <r.icon size={18} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 16, color: t.text }}>{r.label}</span>
                  {r.hint && <span style={{ display: "block", fontSize: 13, color: t.muted, marginTop: 1 }}>{r.hint}</span>}
                </span>
                <span aria-hidden style={{ color: t.muted, display: "flex" }}>
                  <I.ChevronLeft size={18} style={{ transform: "rotate(180deg)" }} />
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      </div>
      {qrOpen && <QrSheet user={user} prefs={prefs} onClose={() => setQrOpen(false)} />}
    </div>
  );
}
