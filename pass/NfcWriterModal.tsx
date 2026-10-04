import React, { useState } from "react";
import { I } from "../ui/icons";

export function NfcWriterModal({
  open,
  onClose,
  user,
  isDark,
  showToast,
}: {
  open: boolean;
  onClose: () => void;
  user: any;
  isDark: boolean;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [writing, setWriting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  if (!open) return null;

  const passUrl = typeof window !== "undefined"
    ? `${window.location.origin}/?card=${user?.id || ""}`
    : `https://www.networq.co.in/?card=${user?.id || ""}`;

  const hasNfcSupport = typeof window !== "undefined" && "NDEFReader" in window;

  const handleWriteNfc = async () => {
    if (!hasNfcSupport) {
      setErrorMsg("Web NFC is currently supported on Android Chrome. On iOS or desktop, use the free NFC Tools app to write this URL to your card.");
      return;
    }

    try {
      setWriting(true);
      setErrorMsg("");
      const ndef = new (window as any).NDEFReader();
      await ndef.write({
        records: [
          {
            recordType: "url",
            data: passUrl,
          },
        ],
      });
      setSuccess(true);
      if (navigator.vibrate) navigator.vibrate([40, 60, 100]);
      showToast("Physical NFC Card successfully programmed!", "success");
    } catch (err: any) {
      console.warn("NFC write error:", err);
      if (err.name === "NotAllowedError") {
        setErrorMsg("NFC permission was denied. Please allow NFC access in your browser settings.");
      } else {
        setErrorMsg(err.message || "Failed to write NFC tag. Hold the card firmly against the back of your phone.");
      }
    } finally {
      setWriting(false);
    }
  };

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
          maxWidth: 480,
          background: bg,
          color: text,
          borderRadius: 24,
          border: `1px solid ${border}`,
          padding: 24,
          boxShadow: "0 25px 60px -12px rgba(0,0,0,0.6)",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <I.Contact size={24} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Program NFC Smart Card</div>
              <div style={{ fontSize: 12, color: textMuted }}>Turn any blank card or sticker into a NetworQ Pass</div>
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
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>

        {/* Visual Graphic */}
        <div
          style={{
            padding: "24px 16px",
            background: cardBg,
            borderRadius: 20,
            border: `1px solid ${border}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              background: writing
                ? "linear-gradient(135deg, #7C3AED, #3B82F6)"
                : success
                ? "linear-gradient(135deg, #10B981, #059669)"
                : "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(59,130,246,0.2))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              boxShadow: writing ? "0 0 30px rgba(124,58,237,0.5)" : "none",
              animation: writing ? "pulse 1.5s infinite" : "none",
            }}
          >
            {success ? <I.Check size={34} strokeWidth={2.4} /> : writing ? <I.Zap size={32} /> : <I.Contact size={32} />}
          </div>

          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {writing
              ? "Hold NFC card against the back of your phone..."
              : success
              ? "NFC Card Ready to Tap!"
              : "Ready to write your Digital Pass"}
          </div>

          <div style={{ fontSize: 12, color: textMuted, maxWidth: 360 }}>
            Payload: <code style={{ color: "#7C3AED" }}>{passUrl}</code>
          </div>

          {errorMsg && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 12px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 10,
                color: "#EF4444",
                fontSize: 12,
                textAlign: "left",
              }}
            >
              {errorMsg}
            </div>
          )}
        </div>

        {/* Action Button */}
        <button
          onClick={handleWriteNfc}
          disabled={writing}
          style={{
            padding: "14px",
            borderRadius: 14,
            border: "none",
            background: success ? "#10B981" : "linear-gradient(135deg, #7C3AED, #6366F1)",
            color: "#FFFFFF",
            fontSize: 15,
            fontWeight: 700,
            cursor: writing ? "default" : "pointer",
            boxShadow: "0 10px 25px rgba(124, 58, 237, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {writing ? "Writing... Hold Card Close" : success ? "Write another card" : "Write to NFC Card Now"}
        </button>

        <div style={{ fontSize: 11, color: textMuted, textAlign: "center" }}>
          Works with all standard NTAG213, NTAG215, NTAG216, metal, or smart cards.
        </div>
      </div>
    </div>
  );
}
