// Settings: profile & photo, security, notifications, data, account deletion.
import React, { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PasswordInput } from "../ui/PasswordInput";
import type { AccountApi } from "./accountApi";
import { OrganizationForm } from "../prospect/OrganizationForm";
import type { ProspectApi } from "../prospect/prospectApi";
import { AppLockSetting, BlockedUsers, HelpAbout, PushSwitch, RecentDevices } from "./MoreSettings";
import { hapticsEnabled, setHapticsEnabled, haptic } from "../ui/haptics";

const PURPLE = "#7C3AED";
export type SettingsSection = "profile" | "organization" | "card" | "notifications" | "privacy" | "security" | "appearance" | "data" | "help" | "account";
type Toast = (message: string, type?: "success" | "error" | "info") => void;

interface Prefs {
  login_alerts: boolean;
  reminder_emails: boolean;
  product_updates: boolean;
  connection_emails: boolean;
}

const DEFAULT_PREFS: Prefs = { login_alerts: true, reminder_emails: true, product_updates: false, connection_emails: true };

function theme(isDark: boolean) {
  return isDark
    ? { surface: "#1C1C1E", raised: "#2C2C2E", text: "#FFFFFF", muted: "#AEAEB2", border: "rgba(255,255,255,0.08)" }
    : { surface: "#FFFFFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", border: "rgba(0,0,0,0.08)" };
}

function downscale(file: File, size = 512): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unavailable"));
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/jpeg", 0.85);
    };
    img.onerror = () => reject(new Error("That file isn't a supported image."));
    img.src = URL.createObjectURL(file);
  });
}

export function SettingsScreen({
  supabase,
  account,
  currentUser,
  isDark,
  showToast,
  onProfileUpdated,
  onSignedOut,
  onExportContacts,
  onToggleTheme,
  onSignOut,
  prospectApi,
  apiBaseUrl,
  section,
  cardSettings,
}: {
  supabase: SupabaseClient;
  account: AccountApi;
  currentUser: any;
  isDark: boolean;
  showToast: Toast;
  onProfileUpdated: (patch: Record<string, unknown>) => void;
  onSignedOut: (message?: string) => void;
  onExportContacts: () => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
  prospectApi?: ProspectApi;
  apiBaseUrl?: string;
  /** Show one category (Me → Settings sub-page); omit to show everything */
  section?: SettingsSection;
  /** Card style & details, supplied by the Me screen */
  cardSettings?: React.ReactNode;
}) {
  const on = (k: SettingsSection) => !section || section === k;
  const [vibration, setVibration] = useState(hapticsEnabled());
  const t = theme(isDark);
  const card: React.CSSProperties = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 20, padding: 20 };
  const input: React.CSSProperties = { minHeight: 44, padding: "10px 14px", borderRadius: 12, border: `1px solid ${t.border}`, background: t.raised, color: t.text, fontSize: 16, width: "100%", boxSizing: "border-box" };
  const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: t.muted, margin: "0 0 6px" };
  const btn = (kind: "primary" | "ghost" | "danger"): React.CSSProperties => ({
    minHeight: 44,
    padding: "10px 18px",
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    border: kind === "primary" ? "none" : `1px solid ${t.border}`,
    background: kind === "primary" ? PURPLE : kind === "danger" ? "#FF3B30" : t.raised,
    color: kind === "ghost" ? t.text : "#FFFFFF",
  });

  // ── Profile ────────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    name: currentUser?.name || "",
    company: currentUser?.company || "",
    role: currentUser?.role || "",
    sector: currentUser?.sector || "",
    phone: currentUser?.phone || "",
    linkedin: currentUser?.linkedin || "",
    bio: currentUser?.bio || "",
  });
  const [avatar, setAvatar] = useState<string | null>(currentUser?.avatar_url || null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveProfile = async () => {
    if (!profile.name.trim() || !profile.company.trim()) return showToast("Name and company are required.", "error");
    setSavingProfile(true);
    try {
      const { error } = await supabase.from("profiles").update(profile).eq("id", currentUser.id);
      if (error) throw error;
      onProfileUpdated(profile);
      showToast("Profile saved.", "success");
    } catch (err: any) {
      showToast(err.message || "Could not save profile.", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    setUploading(true);
    try {
      const blob = await downscale(file);
      const path = `${currentUser.id}/avatar.jpg`;
      const { error } = await supabase.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (error) throw error;
      const url = `${supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      const { error: upErr } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", currentUser.id);
      if (upErr) throw upErr;
      setAvatar(url);
      onProfileUpdated({ avatar_url: url });
      showToast("Photo updated.", "success");
    } catch (err: any) {
      showToast(err.message || "Could not upload photo.", "error");
    } finally {
      setUploading(false);
    }
  };

  // ── Security ───────────────────────────────────────────────────────────────
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  // Google-only accounts have no password to verify — offer "Set a password" instead
  const [hasPassword, setHasPassword] = useState(true);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const providers: string[] = (data.user?.app_metadata as any)?.providers || [];
      if (providers.length) setHasPassword(providers.includes("email"));
    });
  }, [supabase]);

  const changePassword = async () => {
    if (pw.next.length < 8) return showToast("New password must be at least 8 characters.", "error");
    if (pw.next !== pw.confirm) return showToast("New passwords don't match.", "error");
    if (hasPassword && pw.next === pw.current) return showToast("Choose a password different from your current one.", "error");
    setPwBusy(true);
    try {
      if (hasPassword) {
        const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: currentUser.email, password: pw.current });
        if (verifyErr) throw new Error("Current password is incorrect.");
      }
      const { error } = await supabase.auth.updateUser({ password: pw.next });
      if (error) throw error;
      account.sessionEvent("password_changed").catch(() => {});
      setPw({ current: "", next: "", confirm: "" });
      showToast("Password changed. We've emailed you a confirmation.", "success");
    } catch (err: any) {
      showToast(err.message || "Could not change password.", "error");
    } finally {
      setPwBusy(false);
    }
  };

  const changeEmail = async () => {
    const e = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return showToast("Enter a valid email address.", "error");
    if (e === String(currentUser.email).toLowerCase()) return showToast("That's already your email.", "info");
    setEmailBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: e }, { emailRedirectTo: window.location.origin });
      if (error) throw error;
      setNewEmail("");
      showToast(`Check ${e} (and your current inbox) to confirm the change.`, "success");
    } catch (err: any) {
      showToast(err.message || "Could not change email.", "error");
    } finally {
      setEmailBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    await supabase.auth.signOut({ scope: "global" });
    onSignedOut("Signed out of all devices.");
  };

  // ── Notifications ──────────────────────────────────────────────────────────
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULT_PREFS, ...(currentUser?.notification_prefs || {}) });
  const togglePref = async (key: keyof Prefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    const { data, error } = await supabase.rpc("update_notification_prefs", { p_prefs: { [key]: next[key] } });
    if (error) {
      setPrefs(prefs);
      showToast("Could not save preference.", "error");
    } else {
      setPrefs({ ...DEFAULT_PREFS, ...(data as Prefs) });
      onProfileUpdated({ notification_prefs: data });
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const deleteAccount = async () => {
    setDeleting(true);
    try {
      const { scheduled_for } = await account.scheduleDeletion();
      await supabase.auth.signOut({ scope: "local" });
      onSignedOut(`Account scheduled for deletion on ${new Date(scheduled_for).toLocaleDateString()}. Sign in before then to cancel.`);
    } catch (err: any) {
      showToast(err.message || "Could not delete account.", "error");
      setDeleting(false);
    }
  };

  const Switch = ({ id, title, hint }: { id: keyof Prefs; title: string; hint: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ color: t.muted, fontSize: 13 }}>{hint}</div>
      </div>
      <button
        role="switch"
        aria-checked={prefs[id]}
        aria-label={title}
        onClick={() => togglePref(id)}
        style={{ width: 52, minWidth: 52, height: 32, borderRadius: 16, border: "none", padding: 2, cursor: "pointer", background: prefs[id] ? PURPLE : t.raised, boxShadow: `inset 0 0 0 1px ${t.border}` }}
      >
        <span style={{ display: "block", width: 28, height: 28, borderRadius: 14, background: "#FFFFFF", transform: `translateX(${prefs[id] ? 20 : 0}px)`, transition: "transform 0.2s" }} />
      </button>
    </div>
  );

  const field = (key: keyof typeof profile, title: string, placeholder = "") => (
    <div>
      <label style={label} htmlFor={`settings-${key}`}>
        {title}
      </label>
      <input id={`settings-${key}`} style={input} value={profile[key]} placeholder={placeholder} onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))} />
    </div>
  );

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16, color: t.text }}>
      {!section && <h2 style={{ margin: "4px 0 0", fontSize: 28, letterSpacing: "-0.02em" }}>Settings</h2>}
      {section === "card" && cardSettings}

      {on("profile") && (
        <>
      <section style={card} aria-labelledby="settings-profile">
        <h3 id="settings-profile" style={{ margin: "0 0 16px", fontSize: 18 }}>Profile</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          {avatar ? (
            <img src={avatar} alt="Your profile photo" width={72} height={72} style={{ borderRadius: 36, objectFit: "cover" }} />
          ) : (
            <div aria-hidden="true" style={{ width: 72, height: 72, borderRadius: 36, background: "#3A3A3C", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
              </svg>
            </div>
          )}
          <div>
            <button style={btn("ghost")} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : avatar ? "Change photo" : "Add photo"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" aria-label="Upload profile photo" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadAvatar(f); }} />
            <div style={{ color: t.muted, fontSize: 12, marginTop: 6 }}>Shown on Event Radar and to people you connect with.</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {field("name", "Full name *")}
          {field("company", "Company *")}
          {field("role", "Role / title")}
          {field("sector", "Sector")}
          {field("phone", "Phone")}
          {field("linkedin", "LinkedIn", "linkedin.com/in/username")}
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={label} htmlFor="settings-bio">
            Bio
          </label>
          <textarea id="settings-bio" style={{ ...input, minHeight: 88, resize: "vertical" }} value={profile.bio} onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))} />
        </div>
        <button style={{ ...btn("primary"), marginTop: 14 }} onClick={saveProfile} disabled={savingProfile}>
          {savingProfile ? "Saving…" : "Save profile"}
        </button>
      </section>

        </>
      )}

      {on("organization") && (
        <>
      {prospectApi && currentUser?.id && (
        <section style={card} aria-labelledby="settings-org">
          <h3 id="settings-org" style={{ margin: "0 0 4px", fontSize: 18 }}>Your organization</h3>
          <OrganizationForm supabase={supabase} api={prospectApi} userId={currentUser.id} isDark={isDark} showToast={showToast} />
        </section>
      )}

        </>
      )}

      {on("security") && (
        <>
      <section style={card} aria-labelledby="settings-security">
        <h3 id="settings-security" style={{ margin: "0 0 4px", fontSize: 18 }}>Security</h3>
        <div style={{ color: t.muted, fontSize: 14, marginBottom: 16 }}>Signed in as {currentUser?.email}</div>

        <h4 style={{ margin: "0 0 10px", fontSize: 15 }}>{hasPassword ? "Change password" : "Set a password"}</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {hasPassword && <PasswordInput style={input} label="Current password" placeholder="Current password" value={pw.current} onChange={(v) => setPw((p) => ({ ...p, current: v }))} />}
          <PasswordInput style={input} label="New password" placeholder="New password (min 8 characters)" autoComplete="new-password" value={pw.next} onChange={(v) => setPw((p) => ({ ...p, next: v }))} />
          <PasswordInput style={input} label="Confirm new password" placeholder="Confirm new password" autoComplete="new-password" value={pw.confirm} onChange={(v) => setPw((p) => ({ ...p, confirm: v }))} onEnter={changePassword} />
          <button style={{ ...btn("primary"), alignSelf: "flex-start" }} onClick={changePassword} disabled={pwBusy}>
            {pwBusy ? "Updating…" : hasPassword ? "Change password" : "Set password"}
          </button>
        </div>

        <h4 style={{ margin: "22px 0 10px", fontSize: 15 }}>Change email</h4>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={{ ...input, flex: "1 1 220px" }} type="email" aria-label="New email address" placeholder="new@company.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <button style={btn("ghost")} onClick={changeEmail} disabled={emailBusy}>
            {emailBusy ? "Sending…" : "Send confirmation"}
          </button>
        </div>

        <AppLockSetting t={t} showToast={showToast} />
        <RecentDevices supabase={supabase} t={t} btn={btn("ghost")} onSignOutEverywhere={signOutEverywhere} />
      </section>

        </>
      )}

      {on("notifications") && (
        <>
      <section style={card} aria-labelledby="settings-notifications">
        <h3 id="settings-notifications" style={{ margin: "0 0 4px", fontSize: 18 }}>Notifications</h3>
        <PushSwitch supabase={supabase} t={t} apiBaseUrl={apiBaseUrl} showToast={showToast} />
        <Switch id="login_alerts" title="New sign-in alerts" hint="Email me when my account is used on a new device." />
        <Switch id="reminder_emails" title="Follow-up reminders" hint="Email me when a contact reminder is due." />
        <Switch id="connection_emails" title="Connection emails" hint="Email me when someone wants to connect or accepts my request." />
        <Switch id="product_updates" title="Product updates" hint="Occasional news about new NetworQ features." />
      </section>

        </>
      )}

      {on("appearance") && (
        <>
      <section style={card} aria-labelledby="settings-appearance">
        <h3 id="settings-appearance" style={{ margin: "0 0 4px", fontSize: 18 }}>Appearance</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Dark mode</div>
            <div style={{ color: t.muted, fontSize: 13 }}>Easier on the eyes at evening events.</div>
          </div>
          <button
            role="switch"
            aria-checked={isDark}
            aria-label="Dark mode"
            onClick={onToggleTheme}
            style={{ width: 52, minWidth: 52, height: 32, borderRadius: 16, border: "none", padding: 2, cursor: "pointer", background: isDark ? PURPLE : t.raised, boxShadow: `inset 0 0 0 1px ${t.border}` }}
          >
            <span style={{ display: "block", width: 28, height: 28, borderRadius: 14, background: "#FFFFFF", transform: `translateX(${isDark ? 20 : 0}px)`, transition: "transform 0.2s" }} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Vibration</div>
            <div style={{ color: t.muted, fontSize: 13 }}>A light buzz for requests, accepts and the camera shutter.</div>
          </div>
          <button
            role="switch"
            aria-checked={vibration}
            aria-label="Vibration"
            onClick={() => {
              const next = !vibration;
              setHapticsEnabled(next);
              setVibration(next);
              if (next) haptic(20);
            }}
            style={{ width: 52, minWidth: 52, height: 32, borderRadius: 16, border: "none", padding: 2, cursor: "pointer", background: vibration ? PURPLE : t.raised, boxShadow: `inset 0 0 0 1px ${t.border}` }}
          >
            <span style={{ display: "block", width: 28, height: 28, borderRadius: 14, background: "#FFFFFF", transform: `translateX(${vibration ? 20 : 0}px)`, transition: "transform 0.2s" }} />
          </button>
        </div>
      </section>

        </>
      )}

      {on("privacy") && (
        <>
      <BlockedUsers supabase={supabase} t={t} card={card} showToast={showToast} />

        </>
      )}

      {on("data") && (
        <>
      <section style={card} aria-labelledby="settings-data">
        <h3 id="settings-data" style={{ margin: "0 0 12px", fontSize: 18 }}>Your data</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn("ghost")} onClick={onExportContacts}>
            Export contacts (CSV)
          </button>
        </div>
      </section>

        </>
      )}

      {on("help") && (
        <>
      <HelpAbout t={t} card={card} btn={btn("ghost")} userEmail={currentUser?.email} apiBaseUrl={apiBaseUrl} />

        </>
      )}

      {on("account") && (
        <>
      <button style={{ ...btn("ghost"), width: "100%" }} onClick={onSignOut}>
        Sign out
      </button>

      <section style={{ ...card, borderColor: "rgba(255,59,48,0.35)" }} aria-labelledby="settings-delete">
        <h3 id="settings-delete" style={{ margin: "0 0 6px", fontSize: 18, color: "#FF3B30" }}>Delete account</h3>
        <p style={{ color: t.muted, fontSize: 14, margin: "0 0 12px" }}>
          Permanently deletes your profile, contacts, scans, events and connections after a 7-day grace period. You'll be signed out everywhere and can cancel by signing in again before then.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={{ ...input, flex: "1 1 200px" }} aria-label="Type DELETE to confirm" placeholder="Type DELETE to confirm" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} />
          <button style={{ ...btn("danger"), opacity: deleteText === "DELETE" ? 1 : 0.5 }} onClick={deleteAccount} disabled={deleteText !== "DELETE" || deleting}>
            {deleting ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </section>

        </>
      )}
    </div>
  );
}
