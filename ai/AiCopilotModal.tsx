import React, { useState, useRef, useEffect } from "react";

export interface PersonaMask {
  id: string;
  name: string;
  tagline: string;
  avatar: string;
  systemPrompt: string;
  starterPrompts: string[];
}

export const PERSONA_MASKS: PersonaMask[] = [
  {
    id: "wingman",
    name: "Executive Wingman",
    tagline: "Instant icebreakers & contextual talking points",
    avatar: "🎯",
    systemPrompt: `You are the NetworQ Executive Wingman, an elite networking strategist and conversational consultant.
Your role is to craft unforgettable, authentic, and high-impact icebreakers and strategic talking points based on someone's background, role, or company.
Always provide:
1. 2 distinct conversation openers (one casual, one business-insight driven).
2. A high-leverage question to uncover their current priorities.
3. A memorable closing transition.
Keep advice concise, energetic, and executive-ready.`,
    starterPrompts: [
      "I'm about to speak to a VP of Engineering at an AI startup. Give me an icebreaker.",
      "How do I introduce myself to a seed venture capitalist without sounding transactional?",
      "Give me a witty opening line for a product design conference mixer.",
    ],
  },
  {
    id: "closer",
    name: "Follow-up Closer",
    tagline: "High-converting 3-touch cadence emails",
    avatar: "🤝",
    systemPrompt: `You are the NetworQ Follow-up Closer, specialized in turning fleeting event encounters into signed deals, partnerships, and active relationships.
Provide a clear, 3-touch follow-up sequence:
Touch 1 (Within 24 hours): Warm, value-first recap referencing specific discussion points.
Touch 2 (Day 4): Share an insightful resource, article, or strategic idea.
Touch 3 (Day 8): Low-friction CTA for a 15-minute sync.
Format clearly with Subject lines and ready-to-copy bodies.`,
    starterPrompts: [
      "Met a prospect who loved our CRM demo. Write my 24h follow-up email.",
      "Draft a warm follow-up to a potential co-founder I met yesterday.",
      "Write a polite nudge for an investor who asked for our pitch deck.",
    ],
  },
  {
    id: "strategist",
    name: "Radar Strategist",
    tagline: "Prioritize high-value event connections",
    avatar: "📡",
    systemPrompt: `You are the NetworQ Radar Strategist. You help professionals maximize their return on time (ROT) at conferences and networking events.
When given a list of roles, industries, or goals, you analyze who to target, what value to offer them first, and how to structure a 2-hour event session for maximum relationship ROI.`,
    starterPrompts: [
      "I'm at a SaaS tech conference with 500 attendees. How should I spend my next 2 hours?",
      "How do I politely exit a conversation that has hit a dead end?",
      "What is the single best question to ask an executive at an open networking event?",
    ],
  },
  {
    id: "pitch",
    name: "Pitch Refiner",
    tagline: "Crisp 30-second elevator pitch polishing",
    avatar: "💡",
    systemPrompt: `You are the NetworQ Pitch Refiner. You distill complex careers, startups, and ideas into irresistible 15-second and 30-second elevator pitches.
Eliminate jargon, highlight the unique emotional hook and measurable outcome, and leave the listener asking: 'How do you do that?'.`,
    starterPrompts: [
      "Refine my elevator pitch: I build AI-powered networking tools for busy founders.",
      "Make my 15-second pitch punchy for a fast-paced cocktail mixer.",
      "How do I explain enterprise software architecture to non-technical partners?",
    ],
  },
];

export function AiCopilotModal({
  open,
  onClose,
  callAI,
  contacts,
  isDark,
  showToast,
  onDraftOutreach,
}: {
  open: boolean;
  onClose: () => void;
  callAI: (messages: { role: string; content: string }[], systemPrompt?: string, opts?: any) => Promise<string>;
  contacts: any[];
  isDark: boolean;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  onDraftOutreach?: (contact: any) => void;
}) {
  const [selectedMask, setSelectedMask] = useState<PersonaMask>(PERSONA_MASKS[0]);
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string }[]>([
    {
      role: "assistant",
      content: `Hello! I'm your **${PERSONA_MASKS[0].name}**. ${PERSONA_MASKS[0].tagline}. How can I assist your networking today?`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, loading]);

  if (!open) return null;

  const handleSelectMask = (mask: PersonaMask) => {
    setSelectedMask(mask);
    setChatHistory([
      {
        role: "assistant",
        content: `Switched to **${mask.name}** mode. ${mask.tagline}.\n\nTry one of the quick suggestions below or tell me who you're meeting!`,
      },
    ]);
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    setInput("");
    const newHistory = [...chatHistory, { role: "user", content: text }];
    setChatHistory(newHistory);
    setLoading(true);

    try {
      const response = await callAI(
        newHistory.map((m) => ({ role: m.role, content: m.content })),
        selectedMask.systemPrompt,
        { action: "chat", max_tokens: 900 }
      );

      const assistantMsg = response || "I've reviewed your request. What's our next step?";
      setChatHistory((prev) => [...prev, { role: "assistant", content: assistantMsg }]);

      if (isSpeaking && typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(assistantMsg.replace(/[#*`_]/g, ""));
        utterance.rate = 1.05;
        window.speechSynthesis.speak(utterance);
      }
    } catch (err: any) {
      console.warn("AI Copilot error:", err);
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", content: `I encountered an issue: ${err.message || "Please check your network and try again."}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showToast("Copied to clipboard!", "success");
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 950,
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 620,
          height: "min(740px, calc(100dvh - 32px))",
          background: isDark ? "#121217" : "#FFFFFF",
          borderRadius: 24,
          border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.12)" : "#E5E5EA"}`,
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.45)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Top Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "#E5E5EA"}`,
            background: isDark ? "rgba(255, 255, 255, 0.02)" : "#F9FAFB",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24 }}>{selectedMask.avatar}</span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 16, color: isDark ? "#FFFFFF" : "#111827" }}>
                  NetworQ Copilot
                </span>
                <span
                  style={{
                    background: "rgba(124, 58, 237, 0.15)",
                    color: isDark ? "#C4B5FD" : "#7C3AED",
                    fontSize: 10,
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: 999,
                    letterSpacing: "0.04em",
                  }}
                >
                  {selectedMask.name.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: 12, color: isDark ? "#9CA3AF" : "#6B7280" }}>
                {selectedMask.tagline}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setIsSpeaking(!isSpeaking)}
              title={isSpeaking ? "Voice Readout Enabled" : "Voice Readout Disabled"}
              style={{
                background: isSpeaking ? "rgba(124, 58, 237, 0.2)" : "transparent",
                border: `1px solid ${isSpeaking ? "#7C3AED" : isDark ? "rgba(255,255,255,0.1)" : "#E5E5EA"}`,
                borderRadius: 10,
                padding: "6px 10px",
                color: isSpeaking ? (isDark ? "#C4B5FD" : "#7C3AED") : isDark ? "#9CA3AF" : "#6B7280",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {isSpeaking ? "🔊 Voice On" : "🔈 Voice Off"}
            </button>

            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                fontSize: 20,
                color: isDark ? "#9CA3AF" : "#6B7280",
                cursor: "pointer",
                padding: 4,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Persona Masks Tabs */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 18px",
            overflowX: "auto",
            borderBottom: `1px solid ${isDark ? "rgba(255, 255, 255, 0.05)" : "#F3F4F6"}`,
            background: isDark ? "rgba(0, 0, 0, 0.2)" : "#FAFAFA",
          }}
        >
          {PERSONA_MASKS.map((m) => {
            const isSelected = selectedMask.id === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleSelectMask(m)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  whiteSpace: "nowrap",
                  padding: "6px 12px",
                  borderRadius: 12,
                  border: isSelected ? "none" : `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "#E5E5EA"}`,
                  background: isSelected ? "linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)" : isDark ? "rgba(255, 255, 255, 0.03)" : "#FFFFFF",
                  color: isSelected ? "#FFFFFF" : isDark ? "#D1D5DB" : "#4B5563",
                  fontSize: 12,
                  fontWeight: isSelected ? 700 : 500,
                  cursor: "pointer",
                  boxShadow: isSelected ? "0 2px 8px rgba(124, 58, 237, 0.25)" : "none",
                }}
              >
                <span>{m.avatar}</span>
                <span>{m.name}</span>
              </button>
            );
          })}
        </div>

        {/* Messages Feed */}
        <div
          style={{
            flex: 1,
            padding: "16px 20px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {chatHistory.map((m, idx) => {
            const isUser = m.role === "user";
            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isUser ? "flex-end" : "flex-start",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    maxWidth: "85%",
                    padding: "12px 16px",
                    borderRadius: 18,
                    borderBottomRightRadius: isUser ? 4 : 18,
                    borderBottomLeftRadius: isUser ? 18 : 4,
                    background: isUser
                      ? "linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)"
                      : isDark
                      ? "#1A1A22"
                      : "#F3F4F6",
                    color: isUser ? "#FFFFFF" : isDark ? "#F3F4F6" : "#111827",
                    fontSize: 14,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    boxShadow: isUser ? "0 2px 10px rgba(124, 58, 237, 0.25)" : "none",
                  }}
                >
                  {m.content}
                </div>

                {!isUser && (
                  <button
                    onClick={() => copyToClipboard(m.content)}
                    style={{
                      background: "none",
                      border: "none",
                      color: isDark ? "#9CA3AF" : "#6B7280",
                      fontSize: 11,
                      cursor: "pointer",
                      padding: "2px 6px",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span>📋</span> Copy response
                  </button>
                )}
              </div>
            );
          })}

          {loading && (
            <div
              style={{
                alignSelf: "flex-start",
                padding: "12px 16px",
                borderRadius: 18,
                background: isDark ? "#1A1A22" : "#F3F4F6",
                color: isDark ? "#A78BFA" : "#7C3AED",
                fontSize: 13,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ width: 14, height: 14, border: "2px solid rgba(124,58,237,0.3)", borderTopColor: "#7C3AED", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              Thinking with {selectedMask.name}…
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Starter Prompts */}
        {chatHistory.length <= 2 && (
          <div
            style={{
              padding: "8px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              background: isDark ? "rgba(0, 0, 0, 0.2)" : "#FAFAFA",
              borderTop: `1px solid ${isDark ? "rgba(255, 255, 255, 0.05)" : "#F3F4F6"}`,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? "#9CA3AF" : "#6B7280", textTransform: "uppercase" }}>
              Suggested Prompt Ideas
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {selectedMask.starterPrompts.map((p, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(p)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 10,
                    border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.1)" : "#E5E5EA"}`,
                    background: isDark ? "rgba(255, 255, 255, 0.04)" : "#FFFFFF",
                    color: isDark ? "#D1D5DB" : "#374151",
                    fontSize: 12,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          style={{
            padding: "14px 18px",
            borderTop: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "#E5E5EA"}`,
            background: isDark ? "#121217" : "#FFFFFF",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ${selectedMask.name}…`}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: 14,
              border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.12)" : "#D1D5DB"}`,
              background: isDark ? "rgba(255, 255, 255, 0.05)" : "#F9FAFB",
              color: isDark ? "#FFFFFF" : "#111827",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            style={{
              padding: "12px 22px",
              borderRadius: 14,
              border: "none",
              background: "linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)",
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 700,
              cursor: !input.trim() || loading ? "default" : "pointer",
              opacity: !input.trim() || loading ? 0.5 : 1,
            }}
          >
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
