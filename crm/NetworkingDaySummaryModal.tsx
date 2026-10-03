import React, { useState, useMemo } from "react";
import { haptic } from "../ui/haptics";

interface NetworkingDaySummaryModalProps {
  open: boolean;
  onClose: () => void;
  contacts: any[];
  isDark: boolean;
  callAI: (messages: any[], systemPrompt: string, options: any) => Promise<string>;
  onScheduleReminder: (contactId: string, reminderDate: string, note: string) => Promise<void>;
  onDraftEmail: (contact: any) => void;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function NetworkingDaySummaryModal({
  open,
  onClose,
  contacts,
  isDark,
  callAI,
  onScheduleReminder,
  onDraftEmail,
  showToast,
}: NetworkingDaySummaryModalProps) {
  const [generating, setGenerating] = useState(false);
  const [aiPlan, setAiPlan] = useState<string | null>(null);

  // Filter contacts met today or in the last 24h
  const recentContacts = useMemo(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const list = contacts.filter((c) => {
      const added = c.created_at || c.added_at ? new Date(c.created_at || c.added_at).getTime() : 0;
      return added >= oneDayAgo;
    });
    return list.length > 0 ? list : contacts.slice(0, 5); // fallback to recent 5 if none today
  }, [contacts]);

  const uniqueCompanies = useMemo(() => {
    const set = new Set(recentContacts.map((c) => c.company).filter(Boolean));
    return Array.from(set);
  }, [recentContacts]);

  if (!open) return null;

  const handleGeneratePlan = async () => {
    if (recentContacts.length === 0) {
      showToast("No recent contacts to analyze", "info");
      return;
    }

    setGenerating(true);
    haptic();
    try {
      const summaryPayload = recentContacts.map((c) => ({
        name: c.name,
        company: c.company,
        title: c.title,
        notes: c.notes,
        event: c.event,
      }));

      const sys = `You are an elite executive networking strategist.
Analyze these contacts met today and generate a concise, high-impact Follow-up Action Plan.
Categorize them into:
1. High Priority (Immediate 24-hour outreach)
2. Strategic Partnerships (3-day warm follow-up)
3. Stay-in-touch (Add on LinkedIn)
Keep it clear, actionable, and under 150 words.`;

      const plan = await callAI(
        [{ role: "user", content: `Here are the people I met: ${JSON.stringify(summaryPayload)}` }],
        sys,
        { action: "chat", max_tokens: 400 }
      );

      const cleaned = plan.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      setAiPlan(cleaned);
      showToast("Networking Follow-up Plan generated!", "success");
      haptic();
    } catch (err: any) {
      showToast(err.message || "Failed to generate follow-up plan", "error");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.8)",
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
          maxWidth: 620,
          maxHeight: "min(90dvh, calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px))",
          background: isDark ? "#0F1420" : "#FFFFFF",
          color: isDark ? "#F8FAFC" : "#0F172A",
          borderRadius: 24,
          border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
              📅 Networking Day Summary (Part 40)
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: isDark ? "#94A3B8" : "#64748B" }}>
              Consolidated intelligence and automated follow-up strategy.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: isDark ? "#94A3B8" : "#64748B", fontSize: 20, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
          {/* Key Metrics Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div
              style={{
                padding: 14,
                borderRadius: 16,
                background: isDark ? "rgba(124,58,237,0.12)" : "rgba(124,58,237,0.08)",
                border: "1px solid rgba(124,58,237,0.25)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 900, color: "#7C3AED" }}>{recentContacts.length}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? "#A78BFA" : "#6D28D9", textTransform: "uppercase" }}>
                People Met
              </div>
            </div>

            <div
              style={{
                padding: 14,
                borderRadius: 16,
                background: isDark ? "rgba(6,182,212,0.12)" : "rgba(6,182,212,0.08)",
                border: "1px solid rgba(6,182,212,0.25)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 900, color: "#06B6D4" }}>{uniqueCompanies.length}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? "#67E8F9" : "#0891B2", textTransform: "uppercase" }}>
                Companies
              </div>
            </div>

            <div
              style={{
                padding: 14,
                borderRadius: 16,
                background: isDark ? "rgba(16,185,129,0.12)" : "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.25)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 900, color: "#10B981" }}>{recentContacts.filter((c) => c.email).length}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? "#6EE7B7" : "#059669", textTransform: "uppercase" }}>
                Email Ready
              </div>
            </div>
          </div>

          {/* AI Plan Section */}
          <div
            style={{
              padding: 16,
              borderRadius: 16,
              background: isDark ? "rgba(255,255,255,0.03)" : "#F8FAFC",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#E2E8F0"}`,
              marginBottom: 20,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#7C3AED", textTransform: "uppercase" }}>
                🤖 AI Follow-up Strategy
              </span>
              <button
                disabled={generating}
                onClick={handleGeneratePlan}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: "#7C3AED",
                  color: "#FFF",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: generating ? "default" : "pointer",
                  opacity: generating ? 0.6 : 1,
                }}
              >
                {generating ? "Synthesizing…" : "Generate Action Plan"}
              </button>
            </div>

            {aiPlan ? (
              <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", color: isDark ? "#CBD5E1" : "#334155" }}>
                {aiPlan}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: isDark ? "#94A3B8" : "#64748B", fontStyle: "italic" }}>
                Tap "Generate Action Plan" to synthesize high-priority outreach tasks and email follow-ups.
              </div>
            )}
          </div>

          {/* Recent People Met List */}
          <div>
            <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>Recent Connections</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentContacts.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    background: isDark ? "rgba(255,255,255,0.02)" : "#FFFFFF",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "#E2E8F0"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: isDark ? "#94A3B8" : "#64748B" }}>
                      {[c.title, c.company].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {c.email && (
                    <button
                      onClick={() => onDraftEmail(c)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "none",
                        background: "rgba(124,58,237,0.15)",
                        color: "#A78BFA",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      ✉️ Draft Follow-up
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
