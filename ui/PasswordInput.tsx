// Password field with an accessible show/hide toggle.
import React, { useState } from "react";

export function PasswordInput({
  style,
  value,
  onChange,
  placeholder,
  onEnter,
  label,
  autoComplete = "current-password",
}: {
  style: React.CSSProperties;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onEnter?: () => void;
  label?: string;
  autoComplete?: "current-password" | "new-password";
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        style={{ ...style, paddingRight: 52 }}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        aria-label={label}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 44, height: 44, border: "none", background: "transparent", cursor: "pointer", color: "#8E8E93", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <line x1="3" y1="3" x2="21" y2="21" />}
        </svg>
      </button>
    </div>
  );
}
