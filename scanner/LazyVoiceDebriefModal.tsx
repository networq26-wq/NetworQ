import React, { useState, useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LazyDebriefResult {
  name: string;
  role?: string;
  company?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  summary?: string;
  commitment?: string;
  reminder_days?: number;
  email_draft?: {
    subject: string;
    body: string;
  };
}

export function LazyVoiceDebriefModal({
  open,
  onClose,
  supabase,
  currentUser,
  isDark,
  showToast,
  onContactCreated,
  apiBaseUrl,
}: {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  currentUser: any;
  isDark: boolean;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  onContactCreated?: (contact: any) => void;
  apiBaseUrl?: string;
}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<LazyDebriefResult | null>(null);
  const [createdContact, setCreatedContact] = useState<any | null>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize SpeechRecognition if available
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        let current = "";
        for (let i = 0; i < event.results.length; i++) {
          current += event.results[i][0].transcript + " ";
        }
        setTranscript(current.trim());
      };

      recognition.onerror = (e: any) => {
        console.warn("Speech recognition error:", e);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      showToast("Speech recognition is not supported in this browser. Please type your debrief below.", "info");
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        if (!transcript) setTranscript("");
      } catch (err: any) {
        console.warn("Recognition start error:", err);
      }
    }
  };

  const handleProcess = async () => {
    if (!transcript.trim()) {
      showToast("Please speak or type a short voice note first.", "error");
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    setProcessing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || "local-dev-token";
      const base = apiBaseUrl || "";

      const res = await fetch(`${base}/api/ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "lazy_debrief",
          system:
            'You are NetworQ AI Assistant for busy professionals. The user will provide a quick voice memo debrief after meeting someone. Parse the debrief and output strictly valid JSON matching this schema: {"name": string, "role": string, "company": string, "email": string, "phone": string, "tags": string[], "summary": string, "commitment": string, "reminder_days": number, "email_draft": {"subject": string, "body": string}}. Do not wrap in markdown or backticks.',
          messages: [{ role: "user", content: transcript }],
          max_tokens: 1000,
        }),
      });

      if (!res.ok) {
        throw new Error(`AI processing failed: ${res.statusText}`);
      }

      const data = await res.json();
      const rawText = data?.choices?.[0]?.message?.content || "";
      let parsed: LazyDebriefResult;
      try {
        const clean = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        parsed = {
          name: "New Connection",
          role: "Professional",
          company: "",
          tags: ["Voice Debrief"],
          summary: transcript,
          commitment: "Follow up regarding discussion",
          reminder_days: 3,
          email_draft: {
            subject: "Great meeting you!",
            body: `Hi,\n\nIt was great speaking with you today regarding ${transcript.slice(0, 60)}...\n\nLet's stay in touch.\n\nBest regards,\n${currentUser?.name || "NetworQ Member"}`,
          },
        };
      }

      setResult(parsed);

      // AUTO-PILOT: Save to Supabase contacts automatically for the lazy user!
      if (currentUser?.id) {
        const insertPayload: any = {
          user_id: currentUser.id,
          name: parsed.name || "New Connection",
          role: parsed.role || "Professional",
          company: parsed.company || "",
          email: parsed.email || "",
          phone: parsed.phone || "",
          notes: parsed.summary || transcript,
          tags: parsed.tags && parsed.tags.length ? parsed.tags : ["Voice Debrief", "AI Follow-up"],
          created_at: new Date().toISOString(),
        };

        const { data: inserted, error: insertErr } = await supabase
          .from("contacts")
          .insert(insertPayload)
          .select()
          .single();

        if (!insertErr && inserted) {
          setCreatedContact(inserted);
          onContactCreated?.(inserted);

          // AUTO-PILOT REMINDER: Schedule reminder if commitment exists
          if (parsed.commitment || parsed.reminder_days) {
            const days = parsed.reminder_days || 3;
            const remindDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
            try {
              await supabase.from("reminders").insert({
                user_id: currentUser.id,
                contact_id: inserted.id,
                title: `Follow up with ${parsed.name}: ${parsed.commitment || "Check in"}`,
                due_date: remindDate.toISOString(),
                done: false,
              });
            } catch {
              /* ignore reminder insert error */
            }
          }

          showToast(`⚡ Auto-Pilot: ${parsed.name} saved! Reminder & follow-up email ready.`, "success");
        } else {
          showToast(`Contact parsed for ${parsed.name}!`, "success");
        }
      }
    } catch (err: any) {
      console.error("Lazy debrief error:", err);
      showToast(err.message || "Failed to process voice debrief.", "error");
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setTranscript("");
    setResult(null);
    setCreatedContact(null);
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  if (!open) return null;

  const bg = isDark ? "#0D111A" : "#FFFFFF";
  const cardBg = isDark ? "#161B26" : "#F8FAFC";
  const border = isDark ? "rgba(255,255,255,0.1)" : "#E2E8F0";
  const text = isDark ? "#F8FAFC" : "#0F172A";
  const textMuted = isDark ? "#94A3B8" : "#64748B";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(14px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "max(16px, calc(var(--safe-top, 0px) + 12px)) max(16px, calc(var(--safe-right, 0px) + 12px)) max(16px, calc(var(--safe-bottom, 0px) + 12px)) max(16px, calc(var(--safe-left, 0px) + 12px))",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 580,
          maxHeight: "min(92dvh, calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px))",
          background: bg,
          color: text,
          borderRadius: 24,
          border: `1px solid ${border}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 60px -12px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "linear-gradient(135deg, #7C3AED, #3B82F6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
              }}
            >
              🎙️
            </span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Lazy Voice Debrief</div>
              <div style={{ fontSize: 11, color: textMuted }}>Speak for 10s · AI saves contact, sets reminder & drafts email</div>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: isDark ? "rgba(255,255,255,0.08)" : "#E2E8F0",
              color: text,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: 20, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {!result ? (
            <>
              {/* Mic Visualizer & Trigger */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "24px 16px",
                  borderRadius: 20,
                  background: cardBg,
                  border: `1px dashed ${isListening ? "#7C3AED" : border}`,
                  transition: "all 0.25s ease",
                }}
              >
                <button
                  onClick={toggleListening}
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: 38,
                    border: "none",
                    background: isListening
                      ? "linear-gradient(135deg, #EF4444, #F43F5E)"
                      : "linear-gradient(135deg, #7C3AED, #6366F1)",
                    color: "#FFFFFF",
                    fontSize: 28,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: isListening
                      ? "0 0 30px rgba(239, 68, 68, 0.6)"
                      : "0 0 25px rgba(124, 58, 237, 0.4)",
                    transform: isListening ? "scale(1.06)" : "scale(1)",
                    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                >
                  {isListening ? "⏹" : "🎤"}
                </button>
                <div style={{ marginTop: 12, fontSize: 14, fontWeight: 700, color: isListening ? "#EF4444" : text }}>
                  {isListening ? "Listening... Speak naturally" : "Tap microphone to speak"}
                </div>
                <div style={{ fontSize: 12, color: textMuted, marginTop: 4, textAlign: "center" }}>
                  e.g. &ldquo;Met David, VP at Acme. Wants to collaborate on enterprise tier. Ping him on Thursday.&rdquo;
                </div>
              </div>

              {/* Transcript Textarea */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 6, display: "block" }}>
                  Voice Transcript / Notes
                </label>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Or simply type a quick sentence here if you're in a noisy room..."
                  style={{
                    width: "100%",
                    height: 90,
                    padding: 12,
                    borderRadius: 14,
                    border: `1px solid ${border}`,
                    background: isDark ? "rgba(0,0,0,0.3)" : "#FFFFFF",
                    color: text,
                    fontSize: 14,
                    boxSizing: "border-box",
                    resize: "none",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              {/* Action Button */}
              <button
                onClick={handleProcess}
                disabled={processing || !transcript.trim()}
                style={{
                  padding: "14px 20px",
                  borderRadius: 14,
                  border: "none",
                  background: "linear-gradient(135deg, #7C3AED, #3B82F6)",
                  color: "#FFFFFF",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: processing || !transcript.trim() ? "not-allowed" : "pointer",
                  opacity: processing || !transcript.trim() ? 0.6 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: "0 10px 25px rgba(124, 58, 237, 0.35)",
                }}
              >
                {processing ? (
                  <>
                    <span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    Auto-Pilot Processing…
                  </>
                ) : (
                  <>
                    <span>⚡ Process on Auto-Pilot & Save</span>
                  </>
                )}
              </button>
            </>
          ) : (
            /* Results Screen */
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div
                style={{
                  padding: "12px 16px",
                  background: isDark ? "rgba(16, 185, 129, 0.12)" : "#ECFDF5",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  color: isDark ? "#34D399" : "#059669",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <span>✓</span>
                <span>Auto-Pilot Success: Contact & Calendar Reminder Created!</span>
              </div>

              {/* Contact Card Summary */}
              <div style={{ padding: 16, borderRadius: 16, background: cardBg, border: `1px solid ${border}` }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{result.name}</div>
                <div style={{ fontSize: 13, color: textMuted, marginTop: 2 }}>
                  {[result.role, result.company].filter(Boolean).join(" · ") || "Professional"}
                </div>
                {result.tags && result.tags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {result.tags.map((t, idx) => (
                      <span
                        key={idx}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 8,
                          background: isDark ? "rgba(124, 58, 237, 0.25)" : "#EDE9FE",
                          color: isDark ? "#C4B5FD" : "#6D28D9",
                        }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
                {result.commitment && (
                  <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 10, background: isDark ? "rgba(255,255,255,0.04)" : "#F1F5F9", fontSize: 12 }}>
                    <strong>Next Action:</strong> {result.commitment} (Reminder in ~{result.reminder_days || 3} days)
                  </div>
                )}
              </div>

              {/* Email Draft Preview */}
              {result.email_draft && (
                <div style={{ padding: 16, borderRadius: 16, background: cardBg, border: `1px solid ${border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: textMuted }}>Pre-Drafted Follow-Up Email</div>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(`${result.email_draft?.subject}\n\n${result.email_draft?.body}`);
                        showToast("Email draft copied to clipboard!", "success");
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: isDark ? "#A78BFA" : "#7C3AED",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Subject: {result.email_draft.subject}</div>
                  <div style={{ fontSize: 12, color: textMuted, whiteSpace: "pre-line", maxHeight: 120, overflowY: "auto", lineHeight: 1.5 }}>
                    {result.email_draft.body}
                  </div>
                </div>
              )}

              {/* Bottom Buttons */}
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button
                  onClick={handleReset}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: 12,
                    border: `1px solid ${border}`,
                    background: "transparent",
                    color: text,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  🎙️ Debrief Another
                </button>
                <button
                  onClick={onClose}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: 12,
                    border: "none",
                    background: "#7C3AED",
                    color: "#FFFFFF",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
