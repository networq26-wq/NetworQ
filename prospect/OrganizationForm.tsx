// "Your organization" profile: what the user's company does, used in every AI draft.
// Can be pre-filled from the company website; the user reviews and saves.
import React, { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProspectApi } from "./prospectApi";
import { TONES } from "./prospectApi";

const PURPLE = "#7C3AED";

export function palette(isDark: boolean) {
  return isDark
    ? { bg: "#000000", surface: "#1C1C1E", raised: "#2C2C2E", text: "#FFFFFF", muted: "#AEAEB2", border: "rgba(255,255,255,0.10)", accentSoft: "rgba(167,139,250,0.16)", accentText: "#C4B5FD" }
    : { bg: "#F2F2F7", surface: "#FFFFFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", border: "rgba(0,0,0,0.08)", accentSoft: "rgba(124,58,237,0.08)", accentText: PURPLE };
}

export const EMPTY_ORG = {
  company_name: "",
  website: "",
  description: "",
  industry: "",
  services: [] as string[],
  target_customers: "",
  locations: "",
  differentiators: "",
  value_props: "",
  case_studies: "",
  brand_voice: "",
  preferred_tone: "Professional",
  signature: "",
};
export type OrgProfile = typeof EMPTY_ORG & { socials?: Record<string, string> };

const FIELDS: { key: keyof typeof EMPTY_ORG; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: "company_name", label: "Company name", placeholder: "Brightline Digital" },
  { key: "description", label: "What you do", placeholder: "Performance marketing agency for B2B SaaS companies.", multiline: true },
  { key: "industry", label: "Industry", placeholder: "Marketing services" },
  { key: "target_customers", label: "Who you help", placeholder: "B2B SaaS companies selling to enterprises", multiline: true },
  { key: "differentiators", label: "What makes you different", placeholder: "SaaS-only team; reporting tied to pipeline", multiline: true },
  { key: "value_props", label: "Value you deliver", placeholder: "Lower cost per demo; more qualified leads", multiline: true },
  { key: "case_studies", label: "Results & case studies", placeholder: "Cut cost per demo by 38% for an HR-tech SaaS in 4 months", multiline: true },
  { key: "locations", label: "Locations", placeholder: "Chennai, Bengaluru" },
  { key: "brand_voice", label: "Brand voice", placeholder: "Warm, plain-spoken, no jargon" },
  { key: "signature", label: "Email signature", placeholder: "Arjun Mehta\nFounder, Brightline Digital\n+91 98400 12345", multiline: true },
];

export function OrganizationForm({
  supabase,
  api,
  userId,
  isDark,
  showToast,
  onSaved,
  compact,
}: {
  supabase: SupabaseClient;
  api: ProspectApi;
  userId: string;
  isDark: boolean;
  showToast: (m: string, t?: "success" | "error" | "info") => void;
  onSaved?: (org: OrgProfile) => void;
  compact?: boolean;
}) {
  const t = palette(isDark);
  const [org, setOrg] = useState<OrgProfile>(EMPTY_ORG);
  const [servicesText, setServicesText] = useState("");
  const [loading, setLoading] = useState(true);
  const [filling, setFilling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    supabase
      .from("organization_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        if (data) {
          const merged = { ...EMPTY_ORG, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)) } as OrgProfile;
          setOrg(merged);
          setServicesText((merged.services || []).join(", "));
        }
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [supabase, userId]);

  const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 14px", borderRadius: 12, border: `1px solid ${t.border}`, background: t.raised, color: t.text, fontSize: 16, fontFamily: "inherit" };
  const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: t.muted, margin: "14px 0 6px" };

  const autofill = async () => {
    if (!org.website.trim()) return setNote("Enter your website first.");
    setFilling(true);
    setNote("");
    try {
      const { profile, limitations } = await api.autofillOrganization(org.website.trim());
      setOrg((o) => {
        const next = { ...o };
        // Only fill empty fields — never overwrite what the user wrote
        for (const [k, v] of Object.entries(profile)) {
          if (k === "services" || k === "socials") continue;
          if (typeof v === "string" && v && !(o as any)[k]) (next as any)[k] = v;
        }
        next.socials = { ...(o.socials || {}), ...(profile.socials || {}) };
        return next;
      });
      if (!servicesText.trim() && profile.services?.length) setServicesText(profile.services.join(", "));
      setNote(`Filled from ${org.website.trim()}. Check it over and save.${limitations?.length ? " " + limitations[0] : ""}`);
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setFilling(false);
    }
  };

  const save = async () => {
    setSaving(true);
    const row = {
      ...org,
      user_id: userId,
      services: servicesText.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 20),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("organization_profiles").upsert(row);
    setSaving(false);
    if (error) return showToast(error.message || "Couldn't save your organization.", "error");
    showToast("Organization saved.", "success");
    onSaved?.(row as OrgProfile);
  };

  if (loading) return <div style={{ color: t.muted, fontSize: 14, padding: "12px 0" }}>Loading…</div>;

  return (
    <div>
      {!compact && (
        <p style={{ margin: "0 0 4px", color: t.muted, fontSize: 14, lineHeight: 1.45 }}>
          The AI uses this to explain what you do in every email, so you never have to repeat it.
        </p>
      )}
      <label style={label} htmlFor="org-website">Company website</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input id="org-website" style={{ ...input, flex: 1 }} value={org.website} placeholder="yourcompany.com" inputMode="url" autoCapitalize="none" onChange={(e) => setOrg({ ...org, website: e.target.value })} />
        <button onClick={autofill} disabled={filling} style={{ minHeight: 44, padding: "0 14px", borderRadius: 12, border: "none", background: t.accentSoft, color: t.accentText, fontWeight: 600, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" }}>
          {filling ? "Reading…" : "Fill from website"}
        </button>
      </div>
      {note && <div role="status" style={{ marginTop: 8, fontSize: 13, color: t.muted, lineHeight: 1.4 }}>{note}</div>}

      {FIELDS.slice(0, 2).map((f) => (
        <Field key={f.key} f={f} org={org} setOrg={setOrg} input={input} label={label} />
      ))}
      <label style={label} htmlFor="org-services">Services & products</label>
      <textarea id="org-services" style={{ ...input, minHeight: 64, resize: "vertical" }} value={servicesText} placeholder="Paid search, LinkedIn ads, SEO content" onChange={(e) => setServicesText(e.target.value)} />
      {FIELDS.slice(2).map((f) => (
        <Field key={f.key} f={f} org={org} setOrg={setOrg} input={input} label={label} />
      ))}
      <label style={label}>Preferred email tone</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="radiogroup" aria-label="Preferred email tone">
        {TONES.map((tone) => {
          const on = org.preferred_tone === tone;
          return (
            <button key={tone} role="radio" aria-checked={on} onClick={() => setOrg({ ...org, preferred_tone: tone })} style={{ minHeight: 36, padding: "6px 14px", borderRadius: 999, border: `1px solid ${on ? PURPLE : t.border}`, background: on ? PURPLE : "transparent", color: on ? "#FFF" : t.text, fontSize: 14, cursor: "pointer" }}>
              {tone}
            </button>
          );
        })}
      </div>
      <button onClick={save} disabled={saving} style={{ marginTop: 20, width: "100%", minHeight: 48, borderRadius: 14, border: "none", background: PURPLE, color: "#FFF", fontWeight: 600, fontSize: 16, cursor: "pointer" }}>
        {saving ? "Saving…" : "Save organization"}
      </button>
    </div>
  );
}

function Field({ f, org, setOrg, input, label }: { f: (typeof FIELDS)[number]; org: OrgProfile; setOrg: (o: OrgProfile) => void; input: React.CSSProperties; label: React.CSSProperties }) {
  const id = `org-${f.key}`;
  const value = (org[f.key] as string) || "";
  return (
    <>
      <label style={label} htmlFor={id}>{f.label}</label>
      {f.multiline ? (
        <textarea id={id} style={{ ...input, minHeight: f.key === "signature" ? 88 : 64, resize: "vertical", lineHeight: 1.45 }} value={value} placeholder={f.placeholder} onChange={(e) => setOrg({ ...org, [f.key]: e.target.value })} />
      ) : (
        <input id={id} style={input} value={value} placeholder={f.placeholder} onChange={(e) => setOrg({ ...org, [f.key]: e.target.value })} />
      )}
    </>
  );
}
