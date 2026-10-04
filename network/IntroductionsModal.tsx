import React, { useState } from "react";
import { haptic } from "../ui/haptics";

interface IntroductionsModalProps {
  open: boolean;
  onClose: () => void;
  targetContact?: any;
  contacts: any[];
  isDark: boolean;
  onSendIntroRequest: (connectorId: string, targetName: string, targetCompany: string, contextNote: string) => Promise<void>;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function IntroductionsModal({
  open,
  onClose,
  targetContact,
  contacts,
  isDark,
  onSendIntroRequest,
  showToast,
}: IntroductionsModalProps) {
  const [selectedConnectorId, setSelectedConnectorId] = useState(contacts[0]?.id || "");
  const [contextNote, setContextNote] = useState("");
  const [targetName, setTargetName] = useState(targetContact?.name || "");
  const [targetCompany, setTargetCompany] = useState(targetContact?.company || "");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSend = async () => {
    if (!targetName.trim()) {
      showToast("Please enter the name of the person you'd like an intro to", "error");
      return;
    }
    if (!selectedConnectorId) {
      showToast("Please choose a mutual connection to make the intro", "error");
      return;
    }

    setSubmitting(true);
    try {
      await onSendIntroRequest(selectedConnectorId, targetName.trim(), targetCompany.trim(), contextNote.trim());
      haptic();
      showToast("Introduction request sent! We'll notify you once accepted.", "success");
      onClose();
    } catch (err: any) {
      showToast(err.message || "Failed to send introduction request", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedConnector = contacts.find((c) => c.id === selectedConnectorId);

  return (
    <div
      className="nq-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "max(16px, calc(var(--safe-top, 0px) + 12px)) max(16px, calc(var(--safe-right, 0px) + 12px)) max(16px, calc(var(--safe-bottom, 0px) + 12px)) max(16px, calc(var(--safe-left, 0px) + 12px))",
        boxSizing: "border-box",
      }}
    >
      <div
        className="nq-pop"
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "min(92dvh, calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px))",
          overflowY: "auto",
          background: isDark ? "#121826" : "#FFFFFF",
          color: isDark ? "#F8FAFC" : "#0F172A",
          borderRadius: 24,
          border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`,
          padding: 24,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>🤝 Request an Introduction (Part 12)</h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: isDark ? "#94A3B8" : "#64748B" }}>
              Ask a trusted mutual connection to introduce you professionally.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: isDark ? "#94A3B8" : "#64748B", fontSize: 20, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        {/* Target Details */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: isDark ? "#94A3B8" : "#475569" }}>
            Target Person & Company
          </label>
          <input
            type="text"
            placeholder="Person Name"
            value={targetName}
            onChange={(e) => setTargetName(e.target.value)}
            style={{
              width: "100%",
              marginTop: 4,
              padding: "9px 12px",
              borderRadius: 10,
              border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "#CBD5E1"}`,
              background: isDark ? "#0B0F19" : "#F8FAFC",
              color: isDark ? "#FFF" : "#000",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
          <input
            type="text"
            placeholder="Company or Role"
            value={targetCompany}
            onChange={(e) => setTargetCompany(e.target.value)}
            style={{
              width: "100%",
              marginTop: 6,
              padding: "9px 12px",
              borderRadius: 10,
              border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "#CBD5E1"}`,
              background: isDark ? "#0B0F19" : "#F8FAFC",
              color: isDark ? "#FFF" : "#000",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Mutual Connector Selection */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: isDark ? "#94A3B8" : "#475569" }}>
            Introduce via mutual connection:
          </label>
          <select
            value={selectedConnectorId}
            onChange={(e) => setSelectedConnectorId(e.target.value)}
            style={{
              width: "100%",
              marginTop: 4,
              padding: "9px 12px",
              borderRadius: 10,
              border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "#CBD5E1"}`,
              background: isDark ? "#0B0F19" : "#F8FAFC",
              color: isDark ? "#FFF" : "#000",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          >
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.company ? `(${c.company})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Context Note */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: isDark ? "#94A3B8" : "#475569" }}>
            Why would you like to connect? (High-context note)
          </label>
          <textarea
            rows={3}
            placeholder="e.g. Would love to explore potential partnership on their upcoming mobile launch..."
            value={contextNote}
            onChange={(e) => setContextNote(e.target.value)}
            style={{
              width: "100%",
              marginTop: 4,
              padding: "9px 12px",
              borderRadius: 10,
              border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "#CBD5E1"}`,
              background: isDark ? "#0B0F19" : "#F8FAFC",
              color: isDark ? "#FFF" : "#000",
              fontSize: 13,
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />
        </div>

        {/* Submit */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "#CBD5E1"}`,
              background: "transparent",
              color: isDark ? "#FFF" : "#000",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            disabled={submitting}
            onClick={handleSend}
            style={{
              padding: "10px 20px",
              borderRadius: 12,
              border: "none",
              background: "#7C3AED",
              color: "#FFF",
              fontWeight: 800,
              fontSize: 13,
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "Sending…" : "Send Introduction Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
