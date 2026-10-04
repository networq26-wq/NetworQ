// AI prospect research + email drafting, step by step:
//   1 Prospect (confirm details) → research the company (sourced brief)
//   2 Context (manual context, value prospect, tone, email type)
//   3 Drafts A / B / C (copy, edit, regenerate, refine)
//   4 Review → explicit send → logged on the contact's timeline
import React, { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMAIL_TYPES, OPTION_LABELS, REFINEMENTS, TONES, VALUE_OPTIONS, sourceLabel,
  type Draft, type Fact, type ProspectApi, type Research,
} from "./prospectApi";
import { OrganizationForm, palette } from "./OrganizationForm";

const PURPLE = "#7C3AED";
type Step = "prospect" | "context" | "drafts" | "review" | "sent";
const STEPS: { key: Step; label: string }[] = [
  { key: "prospect", label: "Prospect" },
  { key: "context", label: "Context" },
  { key: "drafts", label: "Drafts" },
  { key: "review", label: "Send" },
];
const PROSPECT_FIELDS = [
  ["name", "Name"], ["title", "Role"], ["company", "Company"], ["email", "Email"], ["website", "Website"], ["linkedin", "LinkedIn"], ["location", "Location"],
] as const;

export function ProspectComposer({
  supabase,
  api,
  contact,
  currentUser,
  isDark,
  initialType,
  showToast,
  sendEmail,
  onClose,
  onSent,
}: {
  supabase: SupabaseClient;
  api: ProspectApi;
  contact: { id: string; name: string; [k: string]: any };
  currentUser: { id: string; name?: string; email?: string };
  isDark: boolean;
  initialType?: string;
  showToast: (m: string, t?: "success" | "error" | "info") => void;
  sendEmail: (p: { to: string; subject: string; body: string; fromName?: string; replyTo?: string }) => Promise<{ id?: string; provider?: string }>;
  onClose: () => void;
  onSent: (contactId: string) => void;
}) {
  const t = palette(isDark);
  const [step, setStep] = useState<Step>("prospect");
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(PROSPECT_FIELDS.map(([k]) => [k, contact[k] || ""])));
  const [research, setResearch] = useState<Research | null>(null);
  const [researching, setResearching] = useState(false);
  const [error, setError] = useState("");
  const [hasOrg, setHasOrg] = useState<boolean | null>(null);
  const [orgOpen, setOrgOpen] = useState(false);

  const [manualContext, setManualContext] = useState(() => [contact.event && `Met at ${contact.event}.`, contact.reference].filter(Boolean).join(" "));
  const [valueProps, setValueProps] = useState<string[]>([]);
  const [customValue, setCustomValue] = useState("");
  const [tone, setTone] = useState("Professional");
  const [emailType, setEmailType] = useState(initialType || "Networking follow-up");

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [generating, setGenerating] = useState(false);
  const [busyOption, setBusyOption] = useState<string | null>(null);
  const [subjectPick, setSubjectPick] = useState<Record<string, number>>({});
  const [refineFor, setRefineFor] = useState<string | null>(null);

  const [review, setReview] = useState<{ option: string; subject: string; body: string; to: string } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [sending, setSending] = useState(false);

  // Full contact row (includes research fields), latest research, and whether an org profile exists
  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: row }, { data: last }, { data: org }] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", contact.id).maybeSingle(),
        supabase.from("prospect_research").select("*").eq("contact_id", contact.id).order("created_at", { ascending: false }).limit(1),
        supabase.from("organization_profiles").select("user_id, preferred_tone, company_name").eq("user_id", currentUser.id).maybeSingle(),
      ]);
      if (!alive) return;
      if (row) setForm((f) => ({ ...f, ...Object.fromEntries(PROSPECT_FIELDS.map(([k]) => [k, f[k] || row[k] || ""])) }));
      if (last?.[0]) setResearch(last[0] as Research);
      setHasOrg(!!org?.company_name);
      if (org?.preferred_tone && TONES.includes(org.preferred_tone)) setTone(org.preferred_tone);
    })();
    return () => {
      alive = false;
    };
  }, [supabase, contact.id, currentUser.id]);

  const runResearch = async () => {
    setResearching(true);
    setError("");
    try {
      const { research: r } = await api.research(contact.id, form);
      setResearch(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResearching(false);
    }
  };

  const generate = async (options?: ("A" | "B" | "C")[], refine?: { kind: string; subject: string; body: string }) => {
    setError("");
    if (options) setBusyOption(options[0]);
    else setGenerating(true);
    try {
      const res = await api.draft({ contactId: contact.id, researchId: research?.id, manualContext, valueProps, customValue, tone, emailType, options, refine });
      if (options) {
        setDrafts((prev) => prev.map((d) => res.drafts.find((n) => n.option === d.option) || d));
        setSubjectPick((p) => ({ ...p, [options[0]]: 0 }));
      } else {
        setDrafts(res.drafts);
        setSubjectPick({});
        setStep("drafts");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
      setBusyOption(null);
      setRefineFor(null);
    }
  };

  const copy = async (d: Draft) => {
    const text = `Subject: ${d.subjects[subjectPick[d.option] || 0]}\n\n${d.body}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard.", "success");
    } catch {
      showToast("Couldn't copy — select the text instead.", "error");
    }
  };

  const openReview = (d: Draft) => {
    setReview({ option: d.option, subject: d.subjects[subjectPick[d.option] || 0], body: d.body, to: form.email || "" });
    setConfirmSend(false);
    setStep("review");
  };

  const send = async () => {
    if (!review) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(review.to.trim())) return setError("Add a valid email address for this prospect.");
    if (!confirmSend) return setConfirmSend(true);
    setSending(true);
    setError("");
    try {
      const res = await sendEmail({ to: review.to.trim(), subject: review.subject, body: review.body, fromName: currentUser.name, replyTo: currentUser.email });
      const { count } = await supabase.from("follow_up_emails").select("id", { count: "exact", head: true }).eq("contact_id", contact.id).eq("sent", true);
      await supabase.from("follow_up_emails").insert({
        user_id: currentUser.id,
        contact_id: contact.id,
        to_email: review.to.trim(),
        subject: review.subject,
        draft: review.body,
        draft_option: review.option,
        research_id: research?.id || null,
        value_props: [...valueProps, customValue].filter(Boolean),
        email_type: emailType,
        tone,
        campaign: "AI outreach",
        provider_id: res?.id || null,
        delivery_status: "sent",
        sequence_step: count || 0,
        sent: true,
        sent_at: new Date().toISOString(),
      });
      await supabase.from("contacts").update({ email_sent: true }).eq("id", contact.id);
      onSent(contact.id);
      setStep("sent");
    } catch (e: any) {
      setError(e.message || "Couldn't send the email.");
    } finally {
      setSending(false);
      setConfirmSend(false);
    }
  };

  const back = () => {
    setError("");
    if (step === "context") setStep("prospect");
    else if (step === "drafts") setStep("context");
    else if (step === "review") setStep("drafts");
    else onClose();
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  const card: React.CSSProperties = { background: t.surface, borderRadius: 18, padding: 16, border: `1px solid ${t.border}` };
  const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 14px", borderRadius: 12, border: `1px solid ${t.border}`, background: t.raised, color: t.text, fontSize: 16, fontFamily: "inherit" };
  const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: t.muted, margin: "14px 0 6px" };
  const primary: React.CSSProperties = { width: "100%", minHeight: 50, borderRadius: 14, border: "none", background: PURPLE, color: "#FFF", fontWeight: 600, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 };
  const ghost: React.CSSProperties = { minHeight: 36, padding: "6px 12px", borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.text, fontSize: 14, fontWeight: 500, cursor: "pointer" };
  const chip = (on: boolean): React.CSSProperties => ({ minHeight: 36, padding: "6px 14px", borderRadius: 999, border: `1px solid ${on ? PURPLE : t.border}`, background: on ? PURPLE : "transparent", color: on ? "#FFF" : t.text, fontSize: 14, cursor: "pointer" });
  const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: t.muted, textTransform: "uppercase", letterSpacing: "0.04em", margin: "20px 0 8px" };

  const stepIndex = STEPS.findIndex((s) => s.key === (step === "sent" ? "review" : step));

  return (
    <div role="dialog" aria-label={`Write email to ${contact.name}`} className="nq-backdrop" style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.45)", display: "flex", justifyContent: "center", alignItems: "stretch" }}>
      <div className="nq-sheet-up" style={{ width: "100%", maxWidth: 720, background: t.bg, display: "flex", flexDirection: "column", color: t.text, height: "100%" }}>
        {/* Header */}
        <div style={{ padding: "calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${t.border}`, background: t.surface }}>
          <button onClick={back} aria-label={step === "prospect" || step === "sent" ? "Close" : "Back"} style={{ width: 40, height: 40, borderRadius: 20, border: "none", background: "transparent", color: PURPLE, fontSize: 22, cursor: "pointer" }}>
            {step === "prospect" || step === "sent" ? "✕" : "‹"}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Email {contact.name}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }} aria-label={`Step ${stepIndex + 1} of 4`}>
              {STEPS.map((s, i) => (
                <div key={s.key} style={{ flex: 1 }}>
                  <div style={{ height: 3, borderRadius: 2, background: i <= stepIndex ? PURPLE : t.border }} />
                  <div style={{ fontSize: 11, marginTop: 3, color: i === stepIndex ? t.text : t.muted, fontWeight: i === stepIndex ? 600 : 400 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
          {error && (
            <div role="alert" style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 12, background: "rgba(255,59,48,0.1)", color: "#FF3B30", fontSize: 14 }}>
              {error}
            </div>
          )}

          {/* ── 1. Prospect + research ── */}
          {step === "prospect" && (
            <>
              <div style={card}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Check the details</div>
                <div style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>Fix anything the scan got wrong before we research.</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
                  {PROSPECT_FIELDS.map(([k, l]) => (
                    <div key={k} style={{ gridColumn: k === "name" || k === "email" || k === "website" || k === "linkedin" ? "1 / -1" : undefined }}>
                      <label style={label} htmlFor={`p-${k}`}>{l}</label>
                      <input id={`p-${k}`} style={input} value={form[k]} autoCapitalize={k === "email" || k === "website" || k === "linkedin" ? "none" : "words"} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                    </div>
                  ))}
                </div>
              </div>

              <button style={{ ...primary, marginTop: 16 }} onClick={runResearch} disabled={researching}>
                {researching ? <><Spinner /> Researching {form.company || "the company"}…</> : research ? "Research again" : `Research ${form.company || "company"}`}
              </button>
              {researching && <div style={{ textAlign: "center", color: t.muted, fontSize: 13, marginTop: 8 }}>Reading their website and checking every fact against its source.</div>}

              {research && !researching && <ResearchPanel research={research} t={t} sectionTitle={sectionTitle} card={card} />}

              <button style={{ ...primary, marginTop: 16, background: research ? PURPLE : t.raised, color: research ? "#FFF" : t.text }} onClick={() => setStep("context")} disabled={researching}>
                {research ? "Continue" : "Skip research"}
              </button>
            </>
          )}

          {/* ── 2. Context ── */}
          {step === "context" && (
            <>
              {hasOrg === false && (
                <div style={{ ...card, background: t.accentSoft, border: "none", marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>Tell the AI what your company does</div>
                  <div style={{ color: t.muted, fontSize: 13, margin: "4px 0 10px", lineHeight: 1.4 }}>Without it, drafts can only describe your offer in general terms.</div>
                  <button style={{ ...ghost, borderColor: PURPLE, color: PURPLE }} onClick={() => setOrgOpen(true)}>Set up your organization</button>
                </div>
              )}

              <div style={card}>
                <label style={{ ...label, marginTop: 0 }} htmlFor="ctx-manual">How you met & what they said</label>
                <textarea id="ctx-manual" style={{ ...input, minHeight: 96, resize: "vertical", lineHeight: 1.45 }} value={manualContext} placeholder="Met at a networking event. They want more qualified leads from digital marketing." onChange={(e) => setManualContext(e.target.value)} />
                <div style={{ fontSize: 12, color: t.muted, marginTop: 6 }}>This matters most — it's what the internet doesn't know.</div>
              </div>

              <div style={sectionTitle}>What could help them</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="group" aria-label="Value prospect">
                {VALUE_OPTIONS.map((v) => {
                  const on = valueProps.includes(v);
                  return (
                    <button key={v} aria-pressed={on} style={chip(on)} onClick={() => setValueProps(on ? valueProps.filter((x) => x !== v) : [...valueProps, v])}>
                      {v}
                    </button>
                  );
                })}
              </div>
              <input aria-label="Custom value" style={{ ...input, marginTop: 10 }} value={customValue} placeholder="Something else? e.g. a co-hosted webinar" onChange={(e) => setCustomValue(e.target.value)} />

              <div style={sectionTitle}>Tone</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="radiogroup" aria-label="Tone">
                {TONES.map((x) => (
                  <button key={x} role="radio" aria-checked={tone === x} style={chip(tone === x)} onClick={() => setTone(x)}>{x}</button>
                ))}
              </div>

              <div style={sectionTitle}>Email type</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} role="radiogroup" aria-label="Email type">
                {EMAIL_TYPES.map((x) => (
                  <button key={x} role="radio" aria-checked={emailType === x} style={chip(emailType === x)} onClick={() => setEmailType(x)}>{x}</button>
                ))}
              </div>

              <button style={{ ...primary, marginTop: 22 }} onClick={() => generate()} disabled={generating}>
                {generating ? <><Spinner /> Writing and fact-checking 3 drafts…</> : "Generate 3 drafts"}
              </button>
            </>
          )}

          {/* ── 3. Drafts ── */}
          {step === "drafts" && (
            <>
              {drafts.map((d) => {
                const pick = subjectPick[d.option] || 0;
                const busy = busyOption === d.option;
                return (
                  <section key={d.option} aria-label={`Option ${d.option}`} style={{ ...card, marginBottom: 14, opacity: busy ? 0.6 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 26, height: 26, borderRadius: 13, background: PURPLE, color: "#FFF", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>{d.option}</span>
                      <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{OPTION_LABELS[d.option]}</span>
                      <span style={{ fontSize: 12, color: d.checked ? "#34C759" : t.muted, fontWeight: 600 }}>{d.checked ? "✓ Fact-checked" : "Not fact-checked"}</span>
                    </div>

                    <div style={{ fontSize: 12, color: t.muted, margin: "12px 0 6px", fontWeight: 600 }}>SUBJECT</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} role="radiogroup" aria-label={`Subject for option ${d.option}`}>
                      {d.subjects.map((s, i) => (
                        <button key={i} role="radio" aria-checked={pick === i} onClick={() => setSubjectPick({ ...subjectPick, [d.option]: i })} style={{ textAlign: "left", padding: "8px 12px", borderRadius: 10, border: `1px solid ${pick === i ? PURPLE : t.border}`, background: pick === i ? t.accentSoft : "transparent", color: t.text, fontSize: 14, cursor: "pointer" }}>
                          {s}
                        </button>
                      ))}
                    </div>

                    <div style={{ whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.55, marginTop: 12 }}>{d.body}</div>
                    <div style={{ fontSize: 12, color: t.muted, marginTop: 8 }}>{d.words} words{d.warnings.length ? ` · ⚠︎ ${d.warnings.join(" ")}` : ""}</div>

                    {d.used.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, color: t.muted, fontWeight: 600, marginBottom: 6 }}>RESEARCH USED</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {[...new Set(d.used.map((u) => u.source))].map((s) => (
                            <span key={s} title={d.used.filter((u) => u.source === s).map((u) => u.claim).join("\n")} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: t.raised, color: t.text }}>
                              {sourceLabel(s, research?.sources || [])}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                      <button style={{ ...ghost, background: PURPLE, borderColor: PURPLE, color: "#FFF" }} onClick={() => openReview(d)} aria-label={`Use option ${d.option}`}>Use this</button>
                      <button style={ghost} onClick={() => copy(d)} aria-label={`Copy option ${d.option}`}>Copy</button>
                      <button style={ghost} onClick={() => openReview(d)} aria-label={`Edit option ${d.option}`}>Edit</button>
                      <button style={ghost} disabled={!!busyOption} onClick={() => generate([d.option], { kind: "regenerate", subject: d.subjects[pick], body: d.body })} aria-label={`Regenerate option ${d.option}`}>
                        {busy ? "Working…" : "Regenerate"}
                      </button>
                      <button style={ghost} disabled={!!busyOption} onClick={() => setRefineFor(refineFor === d.option ? null : d.option)} aria-expanded={refineFor === d.option} aria-label={`Refine option ${d.option}`}>Refine ▾</button>
                    </div>
                    {refineFor === d.option && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                        {REFINEMENTS.map((r) => (
                          <button key={r.kind} style={{ ...chip(false), minHeight: 32, fontSize: 13 }} onClick={() => generate([d.option], { kind: r.kind, subject: d.subjects[pick], body: d.body })}>
                            {r.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
              <button style={{ ...ghost, width: "100%", minHeight: 44 }} onClick={() => generate()} disabled={generating || !!busyOption}>
                {generating ? "Writing…" : "Regenerate all three"}
              </button>
            </>
          )}

          {/* ── 4. Review & send ── */}
          {step === "review" && review && (
            <>
              <div style={card}>
                <label style={{ ...label, marginTop: 0 }} htmlFor="r-to">To</label>
                <input id="r-to" style={input} value={review.to} inputMode="email" autoCapitalize="none" onChange={(e) => setReview({ ...review, to: e.target.value })} />
                <label style={label} htmlFor="r-subject">Subject</label>
                <input id="r-subject" style={input} value={review.subject} onChange={(e) => setReview({ ...review, subject: e.target.value })} />
                <label style={label} htmlFor="r-body">Message</label>
                <textarea id="r-body" style={{ ...input, minHeight: 300, resize: "vertical", lineHeight: 1.55 }} value={review.body} onChange={(e) => setReview({ ...review, body: e.target.value })} />
                <div style={{ fontSize: 12, color: t.muted, marginTop: 8, lineHeight: 1.4 }}>
                  Sent from NetworQ as “{currentUser.name || "you"} via NetworQ”. Replies go to {currentUser.email || "your email"}.
                </div>
              </div>
              <button style={{ ...primary, marginTop: 16, background: confirmSend ? "#34C759" : PURPLE }} onClick={send} disabled={sending}>
                {sending ? <><Spinner /> Sending…</> : confirmSend ? `Tap again to send to ${review.to}` : "Send email"}
              </button>
              <a
                href={`mailto:${encodeURIComponent(review.to)}?subject=${encodeURIComponent(review.subject)}&body=${encodeURIComponent(review.body)}`}
                style={{ display: "block", textAlign: "center", marginTop: 12, color: PURPLE, fontSize: 15, textDecoration: "none" }}
              >
                Open in my mail app instead
              </a>
            </>
          )}

          {step === "sent" && review && (
            <div style={{ textAlign: "center", padding: "48px 12px" }}>
              <div style={{ width: 64, height: 64, borderRadius: 32, background: "#34C759", color: "#FFF", fontSize: 32, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>✓</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>Email sent</div>
              <div style={{ color: t.muted, marginTop: 6, fontSize: 15 }}>To {review.to}. It's on {form.name || contact.name}'s timeline.</div>
              <button style={{ ...primary, marginTop: 24 }} onClick={onClose}>Done</button>
            </div>
          )}
        </div>
      </div>

      {orgOpen && (
        <div role="dialog" aria-label="Your organization" className="nq-backdrop" style={{ position: "fixed", inset: 0, zIndex: 410, background: "rgba(0,0,0,0.45)", display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: 720, background: t.bg, color: t.text, overflowY: "auto", padding: "calc(env(safe-area-inset-top, 0px) + 12px) 16px 32px" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 20, fontWeight: 700 }}>Your organization</div>
              <button onClick={() => setOrgOpen(false)} aria-label="Close organization" style={{ ...ghost, border: "none", color: PURPLE }}>Close</button>
            </div>
            <OrganizationForm
              supabase={supabase}
              api={api}
              userId={currentUser.id}
              isDark={isDark}
              showToast={showToast}
              onSaved={(o) => {
                setHasOrg(!!o.company_name);
                if (o.preferred_tone) setTone(o.preferred_tone);
                setOrgOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return <span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.35)", borderTopColor: "#FFF", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} />;
}

function ResearchPanel({ research, t, sectionTitle, card }: { research: Research; t: ReturnType<typeof palette>; sectionTitle: React.CSSProperties; card: React.CSSProperties }) {
  const b = research.brief;
  const srcUrl = useMemo(() => Object.fromEntries(research.sources.map((s) => [s.id, s])), [research.sources]);
  const groups: [string, Fact[]][] = [
    ["Why reach out now", b.signals || []],
    ["What they offer", b.company?.offerings || []],
    ["Who they serve", b.company?.audience || []],
    ["Current initiatives", b.company?.initiatives || []],
    ["How they describe themselves", b.company?.positioning || []],
  ];
  const single = [b.company?.industry, b.company?.business_model].filter(Boolean) as Fact[];
  const verified = [...groups.flatMap(([, f]) => f), ...single].filter((f) => f.status === "verified").length;
  const socials = research.sources.filter((s) => s.kind === "social");
  const pages = research.sources.filter((s) => /^S\d/.test(s.id));

  const FactRow = ({ f }: { f: Fact }) => {
    const s = f.source ? srcUrl[f.source] : null;
    const ok = f.status === "verified";
    return (
      <li style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: `1px solid ${t.border}` }}>
        <span aria-label={ok ? "Verified" : "Not verified"} title={ok ? `Verified: “${f.evidence}”` : "Couldn't confirm this in the source — it won't be used as a fact"} style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 10, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", background: ok ? "rgba(52,199,89,0.15)" : t.raised, color: ok ? "#34C759" : t.muted, marginTop: 1 }}>
          {ok ? "✓" : "?"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, lineHeight: 1.4, color: ok ? t.text : t.muted }}>{f.text}</div>
          {s?.url && (
            <a href={s.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: t.accentText, textDecoration: "none" }}>
              {s.title.length > 40 ? s.title.slice(0, 40) + "…" : s.title}
            </a>
          )}
        </div>
      </li>
    );
  };

  return (
    <div style={{ marginTop: 16 }} aria-label="Research results">
      <div style={card}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{b.company?.name || research.domain || "Research"}</div>
        <div style={{ fontSize: 13, color: t.muted, marginTop: 2 }}>
          {research.domain ? `${pages.length} page${pages.length === 1 ? "" : "s"} read on ${research.domain} · ${verified} verified fact${verified === 1 ? "" : "s"}` : "No website researched"}
        </div>
        {single.length > 0 && <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>{single.map((f, i) => <FactRow key={i} f={f} />)}</ul>}
      </div>

      {groups.filter(([, f]) => f.length).map(([title, facts]) => (
        <div key={title}>
          <div style={sectionTitle}>{title}</div>
          <ul style={{ ...card, listStyle: "none", margin: 0, paddingTop: 4, paddingBottom: 4 }}>{facts.map((f, i) => <FactRow key={i} f={f} />)}</ul>
        </div>
      ))}

      {(b.potential_needs || []).length > 0 && (
        <>
          <div style={sectionTitle}>Possible needs (AI's guess)</div>
          <ul style={{ ...card, listStyle: "none", margin: 0, paddingTop: 4, paddingBottom: 4 }}>
            {b.potential_needs.map((n, i) => (
              <li key={i} style={{ padding: "8px 0", borderTop: i ? `1px solid ${t.border}` : "none", fontSize: 14, lineHeight: 1.4, color: t.muted }}>
                {n.text}
              </li>
            ))}
          </ul>
        </>
      )}

      {socials.length > 0 && (
        <>
          <div style={sectionTitle}>Social profiles</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {socials.map((s) => (
              <a key={s.id} href={s.url || "#"} target="_blank" rel="noreferrer" style={{ fontSize: 13, padding: "6px 12px", borderRadius: 999, background: t.surface, border: `1px solid ${t.border}`, color: t.text, textDecoration: "none" }}>
                {s.title.replace(" (link only)", "")} ↗
              </a>
            ))}
          </div>
        </>
      )}

      {research.limitations?.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12, color: t.muted, lineHeight: 1.45 }}>
          {research.limitations.map((l, i) => <div key={i}>ⓘ {l}</div>)}
        </div>
      )}
    </div>
  );
}
