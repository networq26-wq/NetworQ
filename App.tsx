import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabase";
import QRCode from "qrcode";
import { EventRadar, type ListedEventInput } from "./radar/EventRadar";
import { SettingsScreen } from "./settings/SettingsScreen";
import { apiBase, createAccountApi } from "./settings/accountApi";
import { PasswordInput } from "./ui/PasswordInput";
import { EventsHub } from "./events/EventsHub";

const AI_PROXY =
  process.env.EXPO_PUBLIC_AI_PROXY_URL ||
  (typeof window !== "undefined"
    ? window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? (window.location.port === "8081" ? "http://localhost:3001/api/ai" : "/api/ai")
      : window.location.hostname.includes("networq.co.in") || window.location.hostname.includes("onrender.com")
        ? "/api/ai"
        : "https://www.networq.co.in/api/ai"
    : "https://www.networq.co.in/api/ai");

// Google blocks OAuth inside embedded WebViews, so the Android/iOS shell uses email login only
const IS_NATIVE_WEBVIEW = typeof window !== "undefined" && !!(window as any).ReactNativeWebView;
// Newer Android shells sign in with Google through the system browser (PKCE) and hand the session back
const NATIVE_GOOGLE_AUTH = IS_NATIVE_WEBVIEW && !!(window as any).__NETWORQ_SHELL__?.googleAuth;
const GOOGLE_SIGNIN_AVAILABLE = !IS_NATIVE_WEBVIEW || NATIVE_GOOGLE_AUTH;

const EMAIL_PROXY = process.env.EXPO_PUBLIC_EMAIL_PROXY_URL || AI_PROXY.replace(/\/api\/ai$/, "/api/email");

// ── CONFETTI PARTICLE SYSTEM ──────────────────────────────────────────────────
interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vRot: number;
  alpha: number;
  shape: "circle" | "rect" | "star";
}

let activeConfetti: ConfettiParticle[] = [];
let confettiAnimId: number | null = null;

function triggerConfetti(originX = window.innerWidth / 2, originY = window.innerHeight / 2) {
  if (typeof window === "undefined") return;
  const colors = ["#6366F1", "#8B5CF6", "#06B6D4", "#10B981", "#F59E0B", "#EC4899", "#3B82F6"];
  const count = 65;
  const shapes: ("circle" | "rect" | "star")[] = ["circle", "rect", "star"];

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const speed = 4 + Math.random() * 8;
    activeConfetti.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      size: 5 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.2,
      alpha: 1,
      shape: shapes[Math.floor(Math.random() * shapes.length)],
    });
  }

  const canvas = document.getElementById("networq-confetti-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  if (confettiAnimId) cancelAnimationFrame(confettiAnimId);

  const loop = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = activeConfetti.length - 1; i >= 0; i--) {
      const p = activeConfetti[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.22;
      p.vx *= 0.98;
      p.rotation += p.vRot;
      p.alpha -= 0.015;

      if (p.alpha <= 0 || p.y > canvas.height + 20) {
        activeConfetti.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;

      if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        for (let s = 0; s < 5; s++) {
          ctx.lineTo(Math.cos(((18 + s * 72) * Math.PI) / 180) * p.size, -Math.sin(((18 + s * 72) * Math.PI) / 180) * p.size);
          ctx.lineTo(Math.cos(((54 + s * 72) * Math.PI) / 180) * (p.size / 2), -Math.sin(((54 + s * 72) * Math.PI) / 180) * (p.size / 2));
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    if (activeConfetti.length > 0) {
      confettiAnimId = requestAnimationFrame(loop);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      confettiAnimId = null;
    }
  };
  confettiAnimId = requestAnimationFrame(loop);
}

// ── VCARD (.VCF) GENERATOR ───────────────────────────────────────────────────
function downloadVCard(contact: {
  name: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  website?: string;
  linkedin?: string;
}) {
  const [firstName, ...rest] = (contact.name || "Contact").split(" ");
  const lastName = rest.join(" ");
  const vcard = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${lastName};${firstName};;;`,
    `FN:${contact.name}`,
    contact.company ? `ORG:${contact.company}` : "",
    contact.title ? `TITLE:${contact.title}` : "",
    contact.email ? `EMAIL;TYPE=INTERNET,WORK:${contact.email}` : "",
    contact.phone ? `TEL;TYPE=CELL,VOICE:${contact.phone}` : "",
    contact.website ? `URL:${contact.website}` : "",
    contact.linkedin ? `URL;TYPE=LinkedIn:${contact.linkedin}` : "",
    "NOTE:Connected via NetworQ CRM",
    "END:VCARD",
  ]
    .filter(Boolean)
    .join("\r\n");

  const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(contact.name || "contact").toLowerCase().replace(/\s+/g, "_")}.vcf`;
  a.click();
  URL.revokeObjectURL(url);
  triggerConfetti();
}

// ── APPLE SOUND SYNTHESIZER (WEB AUDIO API) ──────────────────────────────────
function playAppleChime() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Harmonic 1: 523.25 Hz (C5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.45);

    // Harmonic 2: 659.25 Hz (E5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(659.25, now + 0.1);
    gain2.gain.setValueAtTime(0.22, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.65);
  } catch (e) {
    console.warn("Audio feedback not available:", e);
  }
}

// ── APPLE CALENDAR (.ICS) GENERATOR ───────────────────────────────────────────
function downloadAppleCalendarICS(event: {
  title: string;
  date: string;
  time?: string;
  venue?: string;
  city?: string;
  description?: string;
}) {
  const cleanDate = (event.date || "").replace(/-/g, "");
  const icsData = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NetworQ//Apple Calendar Export//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `SUMMARY:${event.title}`,
    `DESCRIPTION:${(event.description || "").replace(/\n/g, "\\n")}`,
    `LOCATION:${[event.venue, event.city].filter(Boolean).join(", ")}`,
    `DTSTART;VALUE=DATE:${cleanDate}`,
    `DTEND;VALUE=DATE:${cleanDate}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:Reminder: ${event.title}`,
    "TRIGGER:-PT1H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([icsData], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── BESPOKE PREMIUM SVG ICONS ────────────────────────────────────────────────
interface IconProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}

const Icons = {
  Logo: ({
    size = 28,
    style,
    color,
    gradient = false,
    scanning = true,
  }: IconProps & { color?: string; gradient?: boolean; scanning?: boolean }) => {
    const brandColor = color || "#7C3AED";
    return (
      <svg
        width={size}
        height={Math.round((size * 551) / 548)}
        viewBox="0 0 548 551"
        fill="none"
        style={{ overflow: "visible", display: "inline-block", verticalAlign: "middle", ...style }}
      >
        <defs>
          <linearGradient id="qPurpleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#6D28D9" />
          </linearGradient>

          <linearGradient id="qLaserGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(192, 132, 252, 0)" />
            <stop offset="25%" stopColor="#C084FC" />
            <stop offset="50%" stopColor="#FFFFFF" />
            <stop offset="75%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="rgba(56, 189, 248, 0)" />
          </linearGradient>

          <linearGradient id="qBeamWash" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(168, 85, 247, 0)" />
            <stop offset="60%" stopColor="rgba(168, 85, 247, 0.2)" />
            <stop offset="100%" stopColor="rgba(56, 189, 248, 0.4)" />
          </linearGradient>

          <filter id="qLaserGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <clipPath id="qInnerCavityClip">
            <rect x="115" y="115" width="284" height="88" rx="8" />
            <rect x="115" y="284" width="264" height="88" rx="8" />
          </clipPath>
        </defs>

        {/* Left bracket (Capture) - exact PDF vector */}
        <path
          d="M 115.08 352.76 C 115.08 363.63, 123.89 372.44, 134.76 372.44 L 216 372.44 L 216 487.53 L 107.59 487.53 C 48.17 487.53, 0 439.36, 0 379.94 L 0 107.57 C 0 48.17, 48.17 0, 107.59 0 L 216 0 L 216 115.08 L 134.76 115.08 C 123.89 115.08, 115.08 123.87, 115.08 134.74 Z"
          fill={gradient ? "url(#qPurpleGrad)" : (color || "#361DD9")}
        />
        {/* Right bracket with Q tail (Continuity) - exact PDF vector */}
        <path
          d="M 468.55 467.77 L 548.05 550.87 L 426.92 550.87 L 365.37 487.53 L 298.01 413.36 L 260.86 372.44 L 379.27 372.44 C 390.12 372.44, 398.93 363.63, 398.93 352.76 L 398.93 134.74 C 398.93 123.87, 390.12 115.08, 379.27 115.08 L 298.01 115.08 L 298.01 0 L 406.43 0 C 465.85 0, 514.01 48.17, 514.01 107.57 L 514.01 379.94 C 514.01 416.22, 496.05 448.31, 468.55 467.77 Z"
          fill={gradient ? "url(#qPurpleGrad)" : (color || "#5E35F5")}
        />
        {/* Center connector bar (Connection) - exact PDF vector */}
        <rect
          x="115.08"
          y="202.75"
          width="283.85"
          height="82.01"
          fill={gradient ? "url(#qPurpleGrad)" : (color || "#715DFC")}
        />

        {/* ── SCANNER BEAM INSIDE THE Q CAVITY ── */}
        {scanning && (
          <g clipPath="url(#qInnerCavityClip)">
            {/* Trailing beam wash */}
            <rect x="110" y="115" width="290" height="34" fill="url(#qBeamWash)">
              <animate attributeName="y" values="115;338;115" dur="2.2s" repeatCount="indefinite" />
            </rect>

            {/* Glowing laser scanning bar */}
            <line
              x1="115"
              y1="118"
              x2="399"
              y2="118"
              stroke="url(#qLaserGrad)"
              strokeWidth="7"
              strokeLinecap="round"
              filter="url(#qLaserGlow)"
            >
              <animate attributeName="y1" values="118;366;118" dur="2.2s" repeatCount="indefinite" />
              <animate attributeName="y2" values="118;366;118" dur="2.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.75;1;0.75" dur="2.2s" repeatCount="indefinite" />
            </line>

            {/* Radar scanner ripple blips inside Q apertures */}
            <circle cx="257" cy="159" r="6" fill="#C084FC" opacity="0.6">
              <animate attributeName="r" values="3;34;3" dur="2.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.8;0;0.8" dur="2.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="247" cy="328" r="6" fill="#38BDF8" opacity="0.5">
              <animate attributeName="r" values="3;30;3" dur="2.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0;0.7" dur="2.2s" repeatCount="indefinite" />
            </circle>
          </g>
        )}
      </svg>
    );
  },
  FileText: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  User: ({ size = 18, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  Bot: ({ size = 18, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16.01" />
      <line x1="16" y1="16" x2="16" y2="16.01" />
    </svg>
  ),
  Volume2: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  ),
  VolumeX: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  ),
  Wordmark: ({ size = 26, isDark = false, style, scanning = true }: { size?: number; isDark?: boolean; style?: React.CSSProperties; scanning?: boolean }) => {
    const textColor = isDark ? "#F5F5F7" : "#1D1D1F";
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: Math.max(2, Math.round(size * 0.05)),
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif",
          fontWeight: 700,
          fontSize: size,
          letterSpacing: "-0.03em",
          color: textColor,
          userSelect: "none",
          lineHeight: 1,
          ...style,
        }}
      >
        <span>Networ</span>
        <Icons.Logo size={Math.round(size * 0.94)} scanning={scanning} />
      </div>
    );
  },
  Home: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  Search: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Sun: ({ size = 18, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  ),
  Moon: ({ size = 18, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  ),
  Users: ({ size = 18, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Scan: ({ size = 18, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  ),
  Camera: ({ size = 18, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  ),
  QrCode:({ size = 18, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3h-3z" />
      <path d="M19 19h2v2h-2z" />
      <path d="M14 19h2" />
      <path d="M19 14v2" />
    </svg>
  ),
  Plus: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Mail: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  ),
  Calendar: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Clock: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Briefcase: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  MessageSquare: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Settings: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Edit: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  Trash: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  Download: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  Table: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="10" y1="3" x2="10" y2="21" />
    </svg>
  ),
  Grid: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  Galaxy: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="3" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="20" cy="16" r="1.5" />
      <circle cx="4" cy="9" r="1.5" />
      <line x1="12" y1="12" x2="19" y2="5" strokeOpacity="0.4" />
      <line x1="12" y1="12" x2="5" y2="19" strokeOpacity="0.4" />
      <line x1="12" y1="12" x2="20" y2="16" strokeOpacity="0.4" />
      <line x1="12" y1="12" x2="4" y2="9" strokeOpacity="0.4" />
    </svg>
  ),
  Radar: ({ size = 18, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <line x1="2" y1="12" x2="22" y2="12" />
    </svg>
  ),
  Bell: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  ),
  Phone: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  Globe: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  Linkedin: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  ),
  Sparkles: ({ size = 18, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  ),
  Flame: ({ size = 16, color = "#F59E0B", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  ),
  Trending: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  Handshake: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="m11 17 2 2a1 1 0 0 0 1.4 0l4.3-4.3a1 1 0 0 0 0-1.4l-3-3" />
      <path d="m7 13 3 3" />
      <path d="M19 12V8a2 2 0 0 0-2-2h-3" />
      <path d="M5 12v4a2 2 0 0 0 2 2h4" />
      <path d="M5 12H3a1 1 0 0 1-1-1V7a2 2 0 0 1 2-2h4a1 1 0 0 1 1 1v2" />
    </svg>
  ),
  Dots: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
    </svg>
  ),
  ArrowRight: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  ChevronRight: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  Send: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  Check: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Close: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Upload: ({ size = 24, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  CheckCircle: ({ size = 18, color = "#10B981", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  AlertCircle: ({ size = 18, color = "#EF4444", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  Command: ({ size = 14, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
    </svg>
  ),
  Tap: ({ size = 18, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect x="5" y="2" width="14" height="20" rx="3" />
      <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2.5" />
      <path d="M9 6h6" />
    </svg>
  ),
  Target: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  Mic: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  Google: ({ size = 18, style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  ),
  MapPin: ({ size = 16, color = "currentColor", style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  Star: ({ size = 16, color = "currentColor", fill = "none", style }: IconProps & { fill?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
};

// ── AI CALLER ─────────────────────────────────────────────────────────────────
async function callAI(
  messages: any[],
  system?: string,
  options: { max_tokens?: number; action?: "email_generation" | "card_scan" | "chat" } = {}
) {
  const { max_tokens = 1000, action } = options;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token || "local-dev-token";

  const formattedMessages: any[] = [];
  if (system) {
    formattedMessages.push({ role: "system", content: system });
  }
  for (const m of messages) {
    formattedMessages.push(m);
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(AI_PROXY, {
      method: "POST",
      headers,
      body: JSON.stringify({ max_tokens, messages: formattedMessages, action }),
    });
  } catch (netErr: any) {
    throw new Error(`Connection error: ${netErr.message || "Failed to reach AI service"}`);
  }

  const contentType = res.headers.get("content-type") || "";
  let d: any;
  if (contentType.includes("application/json")) {
    d = await res.json();
  } else {
    const rawText = await res.text();
    console.warn("AI endpoint returned non-JSON response:", rawText.slice(0, 150));
    throw new Error(`AI service temporarily unavailable (${res.status}). Please try again.`);
  }

  if (!res.ok || d.error) {
    throw new Error(d.error?.message || (typeof d.error === "string" ? d.error : `API error ${res.status}`));
  }
  return d.choices?.[0]?.message?.content || d.content?.[0]?.text || "";
}

// ── EMAIL SENDER (server-side via /api/email — never from the browser) ───────
async function sendEmailViaServer(payload: {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
  replyTo?: string;
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Your session has expired. Please sign in again.");

  let res: Response;
  try {
    res = await fetch(EMAIL_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        to: payload.to,
        subject: payload.subject,
        body: payload.body,
        from_name: payload.fromName,
        reply_to: payload.replyTo,
      }),
    });
  } catch (netErr: any) {
    throw new Error(`Connection error: ${netErr.message || "Failed to reach email service"}`);
  }
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.ok) throw new Error(d.error || `Email service error ${res.status}`);
  return d;
}

// Phone photos are 3–8 MB; scale to max 1280px JPEG before upload/storage/AI
function downscaleImage(dataUrl: string, maxSide = 1280, quality = 0.8): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL("image/jpeg", quality);
      resolve(out.length < dataUrl.length ? out : dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// QR codes are generated on-device — the profile data never leaves the browser
function useQrDataUrl(data: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(data, { width: 260, margin: 1, errorCorrectionLevel: "M" })
      .then((u) => !cancelled && setUrl(u))
      .catch((err) => console.warn("QR generation failed:", err));
    return () => {
      cancelled = true;
    };
  }, [data]);
  return url;
}

// Jitsi Meet rooms are created on first join, so a random room name is a real, working link
function genMeetLink() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const seg = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `https://meet.jit.si/NetworQ-${seg(4)}-${seg(4)}-${seg(4)}`;
}

function avatar(name?: string, isDark = false) {
  return {
    bg: isDark ? "#2C2C2E" : "#E5E5EA",
    color: isDark ? "#AEAEB2" : "#6E6E73",
    letter: "",
  };
}

interface ContactAvatarProps {
  contact?: any;
  name?: string;
  image?: string | null;
  size?: number;
  radius?: number;
  isDark?: boolean;
  style?: React.CSSProperties;
}

function ContactAvatar({ contact, name, image, size = 36, radius = 10, isDark = false, style }: ContactAvatarProps) {
  const photo = image || contact?.image || contact?.photo;
  const displayName = name || contact?.name || "Contact";

  if (photo) {
    return (
      <img
        src={photo}
        alt={displayName}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: "cover",
          flexShrink: 0,
          border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"}`,
          ...style,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: isDark ? "#2C2C2E" : "#E5E5EA",
        color: isDark ? "#AEAEB2" : "#6E6E73",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
        ...style,
      }}
      title={displayName}
    >
      <Icons.User size={Math.max(14, Math.round(size * 0.52))} color={isDark ? "#AEAEB2" : "#6E6E73"} />
    </div>
  );
}

async function extractCard(base64: string, mediaType = "image/jpeg") {
  try {
    const sys = `Extract business card info. Return ONLY JSON:
{"name":string,"title":string,"company":string,"email":string,"phone":string,"website":string,"linkedin":string}
Use null for missing fields.`;
    const text = await callAI(
      [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
            { type: "text", text: "Extract business card info as JSON." },
          ],
        },
      ],
      sys,
      { action: "card_scan" }
    );
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (parsed && (parsed.name || parsed.email || parsed.phone || parsed.company)) {
      return parsed;
    }
  } catch (err) {
    console.warn("Vision extraction error, using fallback extractor:", err);
  }
  return {
    name: "New Connection",
    title: "Executive",
    company: "Organization",
    email: "",
    phone: "",
    website: "",
    linkedin: "",
  };
}

async function checkAndIncrementUsage(supabaseClient: any, userId: string, action: "email_generation" | "card_scan") {
  try {
    const { data, error } = await supabaseClient.rpc("increment_ai_usage", { p_user_id: userId, p_action: action });
    if (error) {
      if (error.message && (error.message.includes("function") || error.message.includes("schema cache"))) {
        return; // Optional DB limiter not installed — proceed gracefully
      }
      console.warn("Usage limit check warning:", error.message);
      return;
    }
    if (data && data.allowed === false) {
      const limit = action === "email_generation" ? 5 : 10;
      throw new Error(
        `Daily limit reached: ${limit} actions per day. Please try again tomorrow.`
      );
    }
  } catch (err: any) {
    if (err.message && err.message.includes("Daily limit")) throw err;
    // Otherwise permit action to prevent user lock-out
  }
}

function generateExecutiveFollowUp(fromUser: any, toContact: any, customAngle?: string) {
  const firstName = (toContact?.name || "there").split(" ")[0];
  const myName = fromUser?.name || "Me";
  const myCompany = fromUser?.company ? ` at ${fromUser.company}` : "";
  const event = toContact?.event ? ` at ${toContact.event}` : "";
  const notes = toContact?.reference ? ` I really enjoyed our discussion regarding ${toContact.reference}.` : "";
  const angle = customAngle ? ` Specifically, I wanted to follow up on ${customAngle}.` : "";

  const subject = `Great connecting with you${event}`;
  const body = `Hi ${firstName},

It was a pleasure meeting you${event ? ` at ${toContact.event}` : " recently"}.${notes}${angle}

I wanted to follow up and see how things are progressing with ${toContact?.company || "your team's priorities"}. I would love to find time for a brief 15-minute conversation to explore mutual collaboration.

Please let me know if you have some availability later this week or next.

Best regards,

${myName}
${fromUser?.role || ""}${myCompany}`;

  return { subject, body, raw: `Subject: ${subject}\n\n${body}` };
}

async function genIntroEmail(fromUser: any, toContact: any, customAngle?: string) {
  try {
    const prompt = customAngle
      ? `Write a concise, professional executive follow-up email from ${fromUser.name} (${fromUser.role} at ${fromUser.company}) to ${toContact.name} (${toContact.title || ""} at ${toContact.company || ""}). Focus angle: ${customAngle}. Format: first line Subject: ..., blank line, then 3 concise paragraphs.`
      : `Write a concise, executive follow-up email from ${fromUser.name} (${fromUser.role} at ${fromUser.company}) to ${toContact.name} (${toContact.title || ""} at ${toContact.company || ""}). They met at ${toContact.event || "a networking event"}. Format: first line = Subject: ..., blank line, then body.`;

    const res = await callAI(
      [{ role: "user", content: prompt }],
      "You write polished, concise, executive networking follow-up emails in a direct Apple/Google tone.",
      { action: "email_generation" }
    );
    if (res && res.trim().length > 30) return res;
  } catch (err) {
    console.warn("AI generation note, using executive template:", err);
  }
  return generateExecutiveFollowUp(fromUser, toContact, customAngle).raw;
}

async function enrichCompanyDomain(urlOrDomain: string) {
  try {
    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: urlOrDomain }),
    });
    const d = await res.json();
    if (d.ok && d.data) return d.data;
  } catch (e) {
    console.warn("Company enrichment note:", e);
  }
  return null;
}

function parseEmailDraft(draft: string) {
  const lines = draft.split("\n");
  const subjectIdx = lines.findIndex((l) => /^subject:/i.test(l.trim()));
  const subject = subjectIdx >= 0 ? lines[subjectIdx].replace(/^subject:\s*/i, "").trim() : "Following up";
  const rest = subjectIdx >= 0 ? lines.slice(subjectIdx + 1) : lines;
  const bodyStart = rest.findIndex((l) => l.trim() !== "");
  const body = bodyStart >= 0 ? rest.slice(bodyStart).join("\n").trim() : draft.trim();
  return { subject, body };
}

function loadGISScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && (window as any).google?.accounts) {
      resolve();
      return;
    }
    if (typeof document === "undefined") {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

async function createCalendarEvent({
  title,
  description,
  date,
  time,
  attendeeEmail,
}: {
  title: string;
  description: string;
  date: string;
  time: string;
  attendeeEmail: string;
}): Promise<{ meetLink: string; eventLink: string }> {
  await loadGISScript();
  if (!(window as any).google?.accounts?.oauth2) {
    throw new Error("Google Calendar is unavailable in this browser.");
  }
  return new Promise((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/calendar.events",
      callback: async (resp: any) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        try {
          const start = new Date(`${date}T${time || "10:00"}`);
          const end = new Date(start.getTime() + 60 * 60 * 1000);
          const res = await fetch(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${resp.access_token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                summary: title,
                description,
                start: { dateTime: start.toISOString() },
                end: { dateTime: end.toISOString() },
                attendees: [{ email: attendeeEmail }],
                conferenceData: {
                  createRequest: {
                    requestId: `networq-${Date.now()}`,
                    conferenceSolutionKey: { type: "hangoutsMeet" },
                  },
                },
              }),
            }
          );
          if (!res.ok) {
            const err = await res.json();
            reject(new Error(err.error?.message || `Calendar API error ${res.status}`));
            return;
          }
          const event = await res.json();
          const meetLink =
            event.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ||
            event.hangoutLink ||
            "";
          resolve({ meetLink, eventLink: event.htmlLink || "" });
        } catch (e: any) {
          reject(e);
        }
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}

function dbToContact(row: any) {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    company: row.company,
    email: row.email,
    phone: row.phone,
    website: row.website,
    linkedin: row.linkedin,
    event: row.event,
    reference: row.reference,
    reminder: row.reminder,
    reminderDate: row.reminder_date,
    image: row.image,
    addedAt: row.added_at,
    reminderDone: row.reminder_done,
    emailSent: row.email_sent,
    meetLink: row.meet_link,
    meetDate: row.meet_date,
    tags: row.tags || [],
  };
}

const SECTORS = [
  "Technology",
  "Finance & Venture",
  "Healthcare",
  "Education",
  "Media & Design",
  "Consumer & Retail",
  "Industrial",
  "Consulting & Legal",
  "Real Estate",
  "Other",
];

function tagColor(tag: string, isDark: boolean) {
  return isDark
    ? { bg: "rgba(255, 255, 255, 0.06)", color: "#AEAEB2", border: "rgba(255, 255, 255, 0.1)" }
    : { bg: "rgba(0, 0, 0, 0.04)", color: "#6E6E73", border: "rgba(0, 0, 0, 0.08)" };
}

// ── FIXED & ROBUST 3D HOLOGRAPHIC PASS COMPONENT ──────────────────────────────
const CARD_THEMES = [
  { id: "aurora", name: "Aurora Hologram", grad: "linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #0e7490 100%)", border: "#818cf8", foil: "rgba(129, 140, 248, 0.4)" },
  { id: "obsidian", name: "Obsidian Titanium", grad: "linear-gradient(135deg, #09090b 0%, #18181b 50%, #27272a 100%)", border: "#71717a", foil: "rgba(255, 255, 255, 0.3)" },
  { id: "cyber", name: "Cyberpunk Amber", grad: "linear-gradient(135deg, #451a03 0%, #78350f 50%, #d97706 100%)", border: "#f59e0b", foil: "rgba(245, 158, 11, 0.4)" },
  { id: "emerald", name: "Emerald Luxe", grad: "linear-gradient(135deg, #022c22 0%, #064e3b 50%, #047857 100%)", border: "#34d399", foil: "rgba(52, 211, 153, 0.4)" },
];

function HoloCard3D({
  user,
  qrData,
  isDark,
  onOpenNameDrop,
}: {
  user: any;
  qrData: string;
  isDark: boolean;
  onOpenNameDrop: () => void;
}) {
  const [themeIdx, setThemeIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, gx: 50, gy: 50 });
  const cardRef = useRef<HTMLDivElement>(null);
  const qrImage = useQrDataUrl(qrData);

  const theme = CARD_THEMES[themeIdx];

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const px = (x / rect.width - 0.5) * 2;
    const py = (y / rect.height - 0.5) * 2;
    setTilt({
      rx: -py * 14,
      ry: px * 14,
      gx: Math.round((x / rect.width) * 100),
      gy: Math.round((y / rect.height) * 100),
    });
  };

  const handleMouseLeave = () => {
    setTilt({ rx: 0, ry: 0, gx: 50, gy: 50 });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      {/* Theme Switcher */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
        {CARD_THEMES.map((t, idx) => (
          <button
            key={t.id}
            onClick={() => setThemeIdx(idx)}
            style={{
              padding: "6px 13px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              border: themeIdx === idx ? `1.5px solid ${t.border}` : "1px solid rgba(255,255,255,0.1)",
              background: themeIdx === idx ? (isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.06)") : "transparent",
              color: isDark ? "#fff" : "#1e293b",
              transition: "all 0.2s ease",
            }}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* 3D Perspective Card Container */}
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          perspective: 1200,
          width: "100%",
          maxWidth: 380,
          height: 230,
          userSelect: "none",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 20,
            position: "relative",
            transformStyle: "preserve-3d",
            transform: `rotateX(${flipped ? -tilt.rx * 0.5 : tilt.rx}deg) rotateY(${flipped ? 180 + tilt.ry * 0.5 : tilt.ry}deg)`,
            transition: "transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)",
            boxShadow: isDark
              ? `0 25px 50px -12px rgba(0,0,0,0.7), 0 0 25px ${theme.foil}`
              : `0 20px 40px -10px rgba(99,102,241,0.25), 0 0 20px ${theme.foil}`,
          }}
        >
          {/* Card Front */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 20,
              background: theme.grad,
              border: `1.5px solid ${theme.border}77`,
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              padding: "24px 26px",
              color: "#ffffff",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              overflow: "hidden",
              zIndex: flipped ? 0 : 2,
            }}
          >
            {/* Holographic Glare Overlay */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: `radial-gradient(circle at ${tilt.gx}% ${tilt.gy}%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.06) 35%, transparent 70%)`,
                pointerEvents: "none",
                mixBlendMode: "overlay",
              }}
            />

            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", zIndex: 1 }}>
              <div>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)" }}>
                  {user?.sector || "FOUNDER & OPERATOR"}
                </span>
                <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 24, fontWeight: 700, marginTop: 4, letterSpacing: "0.01em" }}>
                  {user?.name || "Your Name"}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 }}>
                  {[user?.role, user?.company].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Icons.Logo size={30} />
            </div>

            {/* Footer row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", zIndex: 1 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", display: "flex", flexDirection: "column", gap: 3 }}>
                <div>{user?.email}</div>
                {user?.phone && <div>{user?.phone}</div>}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFlipped(true);
                }}
                style={{
                  background: "rgba(255,255,255,0.18)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.3)",
                  padding: "5px 10px",
                  borderRadius: 8,
                  fontSize: 10,
                  fontWeight: 800,
                  color: "#fff",
                  cursor: "pointer",
                  letterSpacing: "0.06em",
                }}
              >
                SHOW QR ↻
              </button>
            </div>
          </div>

          {/* Card Back (QR Side) */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 20,
              background: theme.grad,
              border: `1.5px solid ${theme.border}77`,
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
              padding: "18px 22px",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              overflow: "hidden",
              zIndex: flipped ? 2 : 0,
            }}
          >
            <div style={{ background: "#ffffff", padding: 8, borderRadius: 14, boxShadow: "0 6px 20px rgba(0,0,0,0.3)" }}>
              {qrImage ? (
                <img src={qrImage} alt="QR Code" style={{ width: 115, height: 115, display: "block" }} />
              ) : (
                <div style={{ width: 115, height: 115 }} />
              )}
            </div>

            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.7)", letterSpacing: "0.12em" }}>NETWORQ PASS</div>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 18, marginTop: 3 }}>Scan to Exchange</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", marginTop: 4, lineHeight: 1.35 }}>
                Camera auto-saves to mobile address book
              </div>

              <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(window.location.href);
                    triggerConfetti();
                  }}
                  style={{
                    background: "rgba(255,255,255,0.22)",
                    border: "none",
                    borderRadius: 6,
                    padding: "4px 8px",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Copy Link
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFlipped(false);
                  }}
                  style={{
                    background: "rgba(255,255,255,0.15)",
                    border: "none",
                    borderRadius: 6,
                    padding: "4px 8px",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Flip Front
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Action Bar Beneath Card */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button
          onClick={() => setFlipped((f) => !f)}
          style={{
            padding: "8px 16px",
            borderRadius: 12,
            background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: isDark ? "#fff" : "#0f172a",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span>Flip Card ↻</span>
        </button>

        <button
          onClick={() => downloadVCard({
            name: user?.name || "My Contact",
            company: user?.company,
            title: user?.role,
            email: user?.email,
            phone: user?.phone,
            linkedin: user?.linkedin,
          })}
          style={{
            padding: "8px 16px",
            borderRadius: 12,
            background: "linear-gradient(135deg, #6366F1, #4F46E5)",
            color: "#ffffff",
            border: "none",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
          }}
        >
          <Icons.Download size={14} />
          <span>Save vCard (.vcf)</span>
        </button>

        <button
          onClick={onOpenNameDrop}
          style={{
            padding: "8px 16px",
            borderRadius: 12,
            background: "linear-gradient(135deg, #06B6D4, #3B82F6)",
            color: "#ffffff",
            border: "none",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "0 4px 14px rgba(6, 182, 212, 0.35)",
          }}
        >
          <Icons.Tap size={14} />
          <span>NameDrop Beam</span>
        </button>
      </div>
    </div>
  );
}

// ── LIVE CAMERA SCANNER MODAL ─────────────────────────────────────────────────
function LiveCameraModal({
  isOpen,
  onClose,
  onCapture,
  isDark,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: any) => void;
  isDark: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setReady(false);
      return;
    }

    setCameraError("");
    setReady(false);

    if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Live camera stream not supported directly by this browser. Tap Open Native Camera.");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().then(() => setReady(true)).catch(console.warn);
          };
        }
      })
      .catch((err) => {
        console.warn("Camera stream error:", err);
        setCameraError(
          err.name === "NotAllowedError"
            ? "Camera permission denied. Please allow camera access in app settings."
            : "Unable to start live camera feed. Please use native camera capture."
        );
      });

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSnap = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `card_scan_${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(file);
        onClose();
      }
    }, "image/jpeg", 0.92);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(12px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: isDark ? "#1C1C1E" : "#FFFFFF",
          borderRadius: 22,
          overflow: "hidden",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: isDark ? "#FFF" : "#000" }}>Live Card Scanner</div>
            <div style={{ fontSize: 12, color: isDark ? "#8E8E93" : "#6E6E73" }}>Fit business card inside frame</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
              border: "none",
              borderRadius: "50%",
              width: 32,
              height: 32,
              cursor: "pointer",
              color: isDark ? "#FFF" : "#000",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ position: "relative", width: "100%", height: 320, background: "#000", overflow: "hidden" }}>
          {cameraError ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", color: "#EF4444" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{cameraError}</div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: "25px 20px",
                  border: "2px dashed rgba(255,255,255,0.85)",
                  borderRadius: 14,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
                  pointerEvents: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ color: "#FFF", fontSize: 12, fontWeight: 600, background: "rgba(0,0,0,0.6)", padding: "5px 12px", borderRadius: 20 }}>
                  Align Business Card
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: "18px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 16, background: isDark ? "#161617" : "#F5F5F7" }}>
          {!cameraError && (
            <button
              onClick={handleSnap}
              disabled={!ready}
              style={{
                width: 62,
                height: 62,
                borderRadius: "50%",
                background: ready ? "linear-gradient(135deg, #0071E3, #2997FF)" : "#8E8E93",
                border: "4px solid rgba(255,255,255,0.8)",
                boxShadow: "0 4px 14px rgba(0,113,227,0.4)",
                cursor: ready ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#FFF",
                fontSize: 22,
              }}
            >
              📸
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── NAMEDROP / SONIC BEAM TAP-TO-SHARE SIMULATOR ──────────────────────────────
function NameDropModal({
  user,
  onClose,
  isDark,
}: {
  user: any;
  onClose: () => void;
  isDark: boolean;
}) {
  const [beaming, setBeaming] = useState(false);

  const startBeam = () => {
    setBeaming(true);
    triggerConfetti();
    setTimeout(() => setBeaming(false), 2600);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        animation: "fadeIn 0.2s ease",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: isDark ? "rgba(15, 23, 42, 0.95)" : "rgba(255, 255, 255, 0.95)",
          borderRadius: 24,
          border: "1px solid rgba(6, 182, 212, 0.3)",
          padding: 28,
          textAlign: "center",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
          animation: "fadeUp 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 60, height: 60, borderRadius: 20, background: "rgba(6, 182, 212, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <Icons.Tap size={32} color="#06B6D4" />
        </div>

        <h3 style={{ fontFamily: "'Poppins', sans-serif", fontSize: 24, margin: 0 }}>NameDrop Beam</h3>
        <p style={{ color: isDark ? "#94a3b8" : "#64748b", fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
          Bring the top of your phone close to another phone to beam your contact card.
        </p>

        {/* Pulsing Magnetic Aura Animation */}
        <div style={{ position: "relative", width: 180, height: 180, margin: "20px auto" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: "2px solid rgba(6, 182, 212, 0.4)",
              animation: beaming ? "pulse 0.8s ease infinite" : "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 25,
              borderRadius: "50%",
              border: "2px dashed rgba(99, 102, 241, 0.5)",
              animation: "spin 8s linear infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 50,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #6366F1, #06B6D4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 14,
              boxShadow: "0 0 25px #06B6D4",
            }}
          >
            {beaming ? "BEAMING…" : "HOLD NEAR"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={startBeam}
            style={{
              flex: 2,
              padding: "11px 20px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #06B6D4, #3B82F6)",
              color: "#fff",
              border: "none",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {beaming ? "Sending Card…" : "Simulate Beam Transfer"}
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "11px 16px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.1)",
              border: "none",
              color: isDark ? "#fff" : "#0f172a",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CMD + K COMMAND PALETTE ───────────────────────────────────────────────────
function CommandPalette({
  isOpen,
  onClose,
  contacts,
  onSelectContact,
  onAction,
  isDark,
  toggleTheme,
}: {
  isOpen: boolean;
  onClose: () => void;
  contacts: any[];
  onSelectContact: (c: any) => void;
  onAction: (tab: string) => void;
  isDark: boolean;
  toggleTheme: () => void;
}) {
  const [q, setQ] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const actions = useMemo(
    () => [
      { id: "scan", label: "Scan Business Card (AI OCR)", icon: Icons.Scan, act: () => onAction("scan") },
      { id: "add", label: "Add Contact Manually", icon: Icons.Plus, act: () => onAction("add") },
      { id: "events", label: "Browse Business Events Hub", icon: Icons.Calendar, act: () => onAction("events") },
      { id: "radar", label: "Launch Live Event Radar", icon: Icons.Radar, act: () => onAction("radar") },
      { id: "qr", label: "Show My 3D QR Card", icon: Icons.QrCode, act: () => onAction("qr") },
      { id: "theme", label: `Switch to ${isDark ? "Light" : "Dark"} Mode`, icon: isDark ? Icons.Sun : Icons.Moon, act: toggleTheme },
    ],
    [onAction, isDark, toggleTheme]
  );

  const filteredContacts = useMemo(
    () =>
      contacts
        .filter((c) =>
          !q ||
          [c.name, c.company, c.title, c.email].some((v) => v?.toLowerCase().includes(q.toLowerCase()))
        )
        .slice(0, 6),
    [contacts, q]
  );

  const totalItems = actions.length + filteredContacts.length;

  useEffect(() => {
    setSelectedIdx(0);
  }, [q]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") setSelectedIdx((i) => (i + 1) % totalItems);
      if (e.key === "ArrowUp") setSelectedIdx((i) => (i - 1 + totalItems) % totalItems);
      if (e.key === "Enter") {
        if (selectedIdx < actions.length) {
          actions[selectedIdx].act();
          onClose();
        } else {
          const c = filteredContacts[selectedIdx - actions.length];
          if (c) {
            onSelectContact(c);
            onClose();
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedIdx, totalItems, actions, filteredContacts, onClose, onSelectContact]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
        paddingLeft: 20,
        paddingRight: 20,
        animation: "fadeIn 0.15s ease",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: isDark ? "rgba(15, 23, 42, 0.9)" : "rgba(255, 255, 255, 0.95)",
          borderRadius: 18,
          border: `1px solid ${isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}`,
          boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
          overflow: "hidden",
          animation: "fadeUp 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`, gap: 10 }}>
          <Icons.Search size={18} color="#6366F1" />
          <input
            autoFocus
            placeholder="Type a command or search contacts… (Esc to exit)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              outline: "none",
              fontSize: 15,
              color: isDark ? "#ffffff" : "#0f172a",
              fontFamily: "'DM Sans', sans-serif",
            }}
          />
          <span style={{ fontSize: 11, background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)", padding: "3px 7px", borderRadius: 6, fontWeight: 700 }}>
            ESC
          </span>
        </div>

        <div style={{ maxHeight: 340, overflowY: "auto", padding: 8 }}>
          {!q && (
            <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? "#94a3b8" : "#64748b", padding: "6px 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Quick Actions
            </div>
          )}
          {actions.map((a, idx) => {
            const isSel = selectedIdx === idx;
            const ActIcon = a.icon;
            return (
              <div
                key={a.id}
                onClick={() => {
                  a.act();
                  onClose();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: 10,
                  cursor: "pointer",
                  background: isSel ? (isDark ? "#4F46E5" : "#6366F1") : "transparent",
                  color: isSel ? "#ffffff" : isDark ? "#f8fafc" : "#0f172a",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <ActIcon size={16} color={isSel ? "#ffffff" : "#6366F1"} />
                <span>{a.label}</span>
              </div>
            );
          })}

          {filteredContacts.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? "#94a3b8" : "#64748b", padding: "10px 12px 6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Contacts ({filteredContacts.length})
              </div>
              {filteredContacts.map((c, idx) => {
                const itemIdx = actions.length + idx;
                const isSel = selectedIdx === itemIdx;
                const av = avatar(c.name);
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      onSelectContact(c);
                      onClose();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 14px",
                      borderRadius: 10,
                      cursor: "pointer",
                      background: isSel ? (isDark ? "rgba(41, 151, 255, 0.18)" : "rgba(0, 113, 227, 0.1)") : "transparent",
                      color: isSel ? (isDark ? "#2997FF" : "#0071E3") : isDark ? "#f8fafc" : "#0f172a",
                      fontSize: 13,
                    }}
                  >
                    <ContactAvatar contact={c} size={26} radius={8} isDark={isDark} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 700 }}>{c.name}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>{[c.title, c.company].filter(Boolean).join(" · ")}</span>
                    </div>
                    <span style={{ fontSize: 11, opacity: 0.6 }}>Open ↗</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}



// ── MAIN APPLICATION COMPONENT ────────────────────────────────────────────────
function NetworQApp() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("networq_theme");
      if (saved === "light" || saved === "dark") return saved;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  });

  const isDark = theme === "dark";

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("networq_theme", theme);
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const [screen, setScreen] = useState<
    "splash" | "login" | "signup" | "forgot_password" | "reset_password" | "complete_profile" | "check_email" | "app"
  >("splash");
  const [splashProgress, setSplashProgress] = useState(15);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<"overview" | "relationship" | "notes" | "opportunities">("overview");
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [tab, setTab] = useState<"contacts" | "events" | "scan" | "qr" | "radar" | "add" | "settings">("contacts");
  const [radarJoinCode, setRadarJoinCode] = useState<string | null>(null);
  const [radarListedEvent, setRadarListedEvent] = useState<ListedEventInput | null>(null);
  // Event invite links: https://www.networq.co.in/?join=NQ-XXXXXX (from the Radar share QR)
  const [inviteCode] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const code = new URLSearchParams(window.location.search).get("join");
    return code && /^NQ-[A-Z0-9]{6}$/i.test(code) ? code.toUpperCase() : null;
  });
  const [viewMode, setViewMode] = useState<"table" | "cards" | "galaxy">("table");
  const [searchQ, setSearchQ] = useState("");
  const [sortCol, setSortCol] = useState("addedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [modal, setModal] = useState<any>(null);
  const [nameDropOpen, setNameDropOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [signupStep, setSignupStep] = useState(1);
  const [authMsg, setAuthMsg] = useState<{ text: string; type: "error" | "success" | "info" } | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    company: "",
    role: "",
    sector: "",
    phone: "",
    linkedin: "",
    bio: "",
  });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  useEffect(() => setConfirmDeleteId(null), [modal?.id]);
  const [forgotEmail, setForgotEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [scanErr, setScanErr] = useState("");
  const [addForm, setAddForm] = useState({
    name: "",
    title: "",
    roleCategory: "Founder",
    company: "",
    email: "",
    phone: "",
    website: "",
    linkedin: "",
    event: "",
    reference: "",
    reminder: "",
    reminderDate: "",
    tags: [] as string[],
    notes: "",
  });
  const [tagInput, setTagInput] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState("all");
  const [addStep, setAddStep] = useState<"form" | "preview">("form");
  const [editingContact, setEditingContact] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [emailModal, setEmailModal] = useState<any>(null);
  const [meetModal, setMeetModal] = useState<any>(null);
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [generatedEmail, setGeneratedEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [bulkEmailModalOpen, setBulkEmailModalOpen] = useState(false);
  const [bulkDrafts, setBulkDrafts] = useState<any[]>([]);
  const [bulkSending, setBulkSending] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [meetDetails, setMeetDetails] = useState({ date: "", time: "", notes: "" });
  const [meetSent, setMeetSent] = useState(false);
  const [meetSending, setMeetSending] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(true);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepBrief, setPrepBrief] = useState<string | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const fileRef = useRef<any>(null);
  const cameraFileRef = useRef<any>(null);
  const qrFileRef = useRef<any>(null);
  const [liveCameraOpen, setLiveCameraOpen] = useState(false);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── AI & VOICE ASSISTANT STATE (NetworQ Intelligence) ─────────────────────────
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiListening, setAiListening] = useState(false);
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState(false);
  const [isSpeakingReply, setIsSpeakingReply] = useState(false);
  const [voicePersona, setVoicePersona] = useState<"siri" | "jarvis">("siri");
  const [speechVoices, setSpeechVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [aiMessages, setAiMessages] = useState<Array<{ role: "user" | "assistant"; content: string; time?: string }>>([
    {
      role: "assistant",
      content: "Hello! I am your NetworQ Voice & AI Assistant. Ask me anything about your contacts, reminders, and follow-up emails, or tap the microphone to speak.",
      time: "Just now",
    },
  ]);
  const aiScrollRef = useRef<HTMLDivElement | null>(null);
  const speechRecRef = useRef<any>(null);

  useEffect(() => {
    if (aiOpen) {
      aiScrollRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [aiMessages, aiOpen]);

  // Pre-load and cache native browser/OS voices (Apple Siri, Samantha, Daniel, Natural)
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const loadVoices = () => {
      try {
        const vs = window.speechSynthesis.getVoices();
        if (vs && vs.length > 0) {
          setSpeechVoices(vs);
        }
      } catch (e) {}
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const getPersonaVoice = (persona: "siri" | "jarvis", customVoices?: SpeechSynthesisVoice[]) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    const list = customVoices && customVoices.length > 0 ? customVoices : window.speechSynthesis.getVoices();
    if (!list || list.length === 0) return null;

    if (persona === "siri") {
      // 1. Explicit Apple Siri voices (macOS / iOS)
      const siri = list.find((v) => /siri/i.test(v.name) && v.lang.startsWith("en"));
      if (siri) return siri;

      // 2. Samantha (Apple's canonical US Siri voice on macOS and iOS)
      const samantha = list.find((v) => /samantha/i.test(v.name));
      if (samantha) return samantha;

      // 3. Apple premium natural voices (Ava, Allison, Karen, Moira)
      const appleNatural = list.find((v) => /(ava|allison|karen|moira|victoria)/i.test(v.name) && v.lang.startsWith("en"));
      if (appleNatural) return appleNatural;

      // 4. Chrome / Edge high fidelity natural voices
      const googleNatural = list.find((v) => /(google us english|natural|jenny|aria)/i.test(v.name) && v.lang.startsWith("en"));
      if (googleNatural) return googleNatural;
    } else {
      // 1. Daniel (Apple's canonical British Jarvis executive voice)
      const daniel = list.find((v) => /daniel/i.test(v.name) && v.lang.startsWith("en"));
      if (daniel) return daniel;

      // 2. British executive natural voices
      const british = list.find((v) => /(oliver|arthur|george|google uk english male|guy|ryan)/i.test(v.name) && v.lang.startsWith("en"));
      if (british) return british;
    }

    // Default high-quality English voice
    return (
      list.find((v) => v.lang.startsWith("en") && !v.localService) ||
      list.find((v) => v.lang.startsWith("en-US")) ||
      list.find((v) => v.lang.startsWith("en")) ||
      list[0]
    );
  };

  const playAiVoice = (speechText: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();

    const cleanText = speechText
      .replace(/[*_#`[\]()~]/g, " ")
      .replace(/•/g, ", ")
      .replace(/\bCRM\b/g, "C R M")
      .replace(/\bAI\b/g, "A I")
      .replace(/https?:\/\/\S+/g, "link")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 420);

    if (!cleanText) return;

    const utter = new SpeechSynthesisUtterance(cleanText);
    const targetVoice =
      speechVoices.find((v) => /(natural|samantha|ava|google us english|daniel|george)/i.test(v.name)) ||
      speechVoices.find((v) => v.lang.startsWith("en-US")) ||
      speechVoices.find((v) => v.lang.startsWith("en")) ||
      speechVoices[0];

    if (targetVoice) {
      utter.voice = targetVoice;
    }
    utter.rate = 1.0;
    utter.pitch = 1.0;

    utter.onend = () => setIsSpeakingReply(false);
    utter.onerror = () => setIsSpeakingReply(false);
    setIsSpeakingReply(true);
    window.speechSynthesis.speak(utter);
  };
  const playJarvisVoice = playAiVoice;

  const sendAiQuery = async (queryText?: string, wasSpoken = false) => {
    const text = (queryText || aiInput).trim();
    if (!text || aiLoading) return;
    setAiInput("");

    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const newHistory = [...aiMessages, { role: "user" as const, content: text, time: now }];
    setAiMessages(newHistory);
    setAiLoading(true);

    try {
      const dueRemindersList = contacts.filter((c) => c.reminder && c.reminderDate && !c.reminderDone);
      const pendingFollowups = contacts.filter((c) => !c.emailSent);
      const contactSummary = contacts.slice(0, 50).map((c) => 
        `- ${c.name} (${c.roleCategory || c.role || "Executive"} at ${c.company || "Company"}). Email: ${c.email || "No email"}. Scheduled reminder: ${c.reminder && c.reminderDate ? c.reminderDate : "none"}. Follow-up email: ${c.emailSent ? "already sent" : "needs email"}. Notes: ${c.notes || "None"}.`
      ).join("\n");

      const systemPrompt = `You are NetworQ's Elite AI Assistant for ${currentUser?.name || "the user"}.
You have direct, real-time access to the user's live NetworQ CRM database:

CURRENT REAL-TIME CRM DATA:
• Total Contacts in Network: ${contacts.length}
• Scheduled Reminders Due (${dueRemindersList.length}):
${dueRemindersList.length > 0 
  ? dueRemindersList.map((c) => `  - ${c.name} (${c.company || "Company"}): Scheduled for ${c.reminderDate}. Notes: ${c.reminderNotes || c.notes || "None"}`).join("\n") 
  : "  - 0 scheduled reminders."}

• Contacts Needing Follow-up Emails (${pendingFollowups.length}):
${pendingFollowups.length > 0 
  ? pendingFollowups.slice(0, 10).map((c) => `  - ${c.name} (${c.company || "Company"}): Email ${c.email || "No email on file"}.`).join("\n") 
  : "  - 0 pending follow-up emails. All contacts are up to date."}

CONTACT ROSTER:
${contactSummary || "Your CRM currently contains 0 contacts."}

VOICE & ASSISTANT DIRECTIVES:
1. When asked "from whom should I send mails and reminders?" or "who should I email / follow up with?":
   - IF TOTAL CONTACTS IS 0:
     State clearly and directly: "You currently have 0 contacts in your NetworQ CRM. You don't have any scheduled reminders or pending follow-up emails. Tap '+ Add Contact' or scan a business card, and I will track all their reminders and draft outreach emails for you."
   - IF CONTACTS EXIST:
     Break your response clearly into two structured sections:
     A) Scheduled Reminders: Clearly name each person with their company, reminder date, and purpose.
     B) Pending Emails: Clearly name each person who needs a follow-up email along with their email address.
     Conclude with a proactive offer: "Would you like me to draft a follow-up email or open their contact card right now?"
2. Tone & Voice: Articulate, calm, executive, warm, and highly intelligent.
3. Conversational Audio Formatting: Do NOT use complex markdown tables or excessive symbols. Keep sentences crisp, natural, and rhythmic so it sounds exceptional over voice synthesis.`;

      const responseText = await callAI(
        newHistory.map((m) => ({ role: m.role, content: m.content })),
        systemPrompt,
        { action: "chat", max_tokens: 800 }
      );

      const replyContent = responseText || "I've reviewed your request. How else may I assist your network?";
      setAiMessages((prev) => [...prev, { role: "assistant", content: replyContent, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);

      if (wasSpoken || voiceReplyEnabled) {
        playJarvisVoice(replyContent);
      }
    } catch (e: any) {
      console.warn("AI Assistant error:", e);
      const fallbackReply = `I've analyzed your network. ${e.message ? `(Notice: ${e.message})` : ""}. How can I assist you with your contacts, roles, or follow-ups?`;
      setAiMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: fallbackReply,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      if (wasSpoken || voiceReplyEnabled) {
        playJarvisVoice(fallbackReply);
      }
    } finally {
      setAiLoading(false);
    }
  };

  const toggleMicListening = () => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Speech recognition is not supported in this browser. Please type your message.", "info");
      return;
    }

    if (aiListening && speechRecRef.current) {
      speechRecRef.current.stop();
      setAiListening(false);
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";

      rec.onstart = () => {
        setAiListening(true);
        setVoiceReplyEnabled(true);
      };

      rec.onresult = (ev: any) => {
        const transcript = ev.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setAiInput(transcript);
          sendAiQuery(transcript, true);
        }
      };

      rec.onerror = (ev: any) => {
        setAiListening(false);
        if (ev.error !== "no-speech") {
          showToast(`Voice input: ${ev.error}`, "info");
        }
      };

      rec.onend = () => {
        setAiListening(false);
      };

      speechRecRef.current = rec;
      rec.start();
    } catch (err: any) {
      console.warn("Speech start failed:", err);
      setAiListening(false);
    }
  };

  const toggleSpeechPlayback = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      showToast("Text-to-speech is not supported in this browser.", "info");
      return;
    }
    if (isSpeakingReply) {
      window.speechSynthesis.cancel();
      setIsSpeakingReply(false);
    }
    setVoiceReplyEnabled(!voiceReplyEnabled);
    showToast(!voiceReplyEnabled ? "Voice speech responses: ON" : "Voice speech responses: OFF", "info");
  };

  // Which user's data is loaded — prevents duplicate loads from login + auth events
  const loadedUserRef = useRef<string | null>(null);

  const loadUserData = useCallback(
    async (userId: string, userEmail?: string) => {
      loadedUserRef.current = userId;
      setContactsLoading(true);
      try {
        const [profileRes, contactsRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
          supabase.from("contacts").select("*").eq("user_id", userId).order("added_at", { ascending: false }),
        ]);

        // First login after email confirmation: create the profile from signup metadata
        if (!profileRes.data?.company) {
          const { data: userRes } = await supabase.auth.getUser();
          const meta = userRes?.user?.user_metadata || {};
          if (meta.company) {
            const { data: created, error: createErr } = await supabase
              .from("profiles")
              .upsert({
                id: userId,
                name: meta.name || meta.full_name || "",
                company: meta.company,
                role: meta.role || null,
                sector: meta.sector || null,
                phone: meta.phone || null,
                linkedin: meta.linkedin || null,
                bio: meta.bio || null,
              })
              .select()
              .single();
            if (!createErr && created) profileRes.data = created;
          }
        }

        if (!profileRes.data || !profileRes.data.company) {
          setCurrentUser({ id: userId, email: userEmail, ...(profileRes.data || {}) });
          setForm((f) => ({
            ...f,
            name: profileRes.data?.name || "",
            phone: profileRes.data?.phone || "",
            linkedin: profileRes.data?.linkedin || "",
          }));
          setScreen("complete_profile");
          setContactsLoading(false);
          return;
        }

        setCurrentUser({ ...(profileRes.data || {}), email: userEmail, id: userId });
        setContacts((contactsRes.data || []).map(dbToContact));
        setScreen("app");
        // Sign-in notification (welcome / new device). Once per browser session.
        try {
          const key = `nq_signin_reported_${userId}`;
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, "1");
            createAccountApi(supabase, apiBase(AI_PROXY)).sessionEvent("signed_in").catch(() => {});
          }
        } catch {
          /* storage unavailable */
        }
      } catch (err: any) {
        loadedUserRef.current = null;
        console.error("Failed to load user data:", err);
        showToast(err.message || "Failed to load profile", "error");
      } finally {
        setContactsLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    // Never await Supabase calls inside this callback: supabase-js runs it while holding its
    // auth lock, so any query here deadlocks getSession() (the old "splash stuck at 92%" bug).
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setScreen("reset_password");
      } else if (event === "SIGNED_IN" && session?.user) {
        const { id, email } = session.user;
        setTimeout(() => {
          if (loadedUserRef.current !== id) loadUserData(id, email);
        }, 0);
      } else if (event === "SIGNED_OUT") {
        loadedUserRef.current = null;
        setCurrentUser(null);
        setContacts([]);
        setScreen("login");
      }
    });

    (async () => {
      const p1 = setTimeout(() => setSplashProgress(45), 120);
      const p2 = setTimeout(() => setSplashProgress(75), 280);
      const p3 = setTimeout(() => setSplashProgress(92), 440);
      // Hard failsafe: force past 92% if the 4s session race below somehow never settles
      const pForce = setTimeout(() => {
        setSplashProgress(100);
        setScreen("login");
      }, 4500);

      const splashDelay = new Promise<void>((resolve) => setTimeout(resolve, 600));

      // Race supabase.auth.getSession() against a 4s timeout — never freeze
      let session: any = null;
      try {
        const sessionResult = await Promise.race([
          supabase.auth.getSession().then((r: any) => r.data.session),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        session = sessionResult;
      } catch {
        session = null;
      }

      clearTimeout(pForce);
      setSplashProgress(100);

      if (session?.user) {
        await Promise.all([
          loadedUserRef.current === session.user.id ? Promise.resolve() : loadUserData(session.user.id, session.user.email),
          splashDelay,
        ]);
      } else {
        await splashDelay;
        setScreen("login");
      }
      clearTimeout(p1);
      clearTimeout(p2);
      clearTimeout(p3);
    })();

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [loadUserData]);

  useEffect(() => {
    if (screen !== "app" || !inviteCode) return;
    setRadarJoinCode(inviteCode);
    setTab("radar");
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      /* non-browser host */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, inviteCode]);

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handleCmdK = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handleCmdK);
    return () => window.removeEventListener("keydown", handleCmdK);
  }, []);


  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setAuthMsg(null);
    if (NATIVE_GOOGLE_AUTH) {
      const onNative = async (e: Event) => {
        const msg = (e as CustomEvent).detail;
        if (msg?.type !== "auth:session" && msg?.type !== "auth:error") return;
        window.removeEventListener("networq-native", onNative);
        if (msg.type === "auth:error") {
          setAuthMsg({ text: msg.message, type: "error" });
          setGoogleLoading(false);
          return;
        }
        const { error } = await supabase.auth.setSession({ access_token: msg.access_token, refresh_token: msg.refresh_token });
        if (error) setAuthMsg({ text: error.message, type: "error" });
        setGoogleLoading(false);
      };
      window.addEventListener("networq-native", onNative);
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type: "auth:google" }));
      return;
    }
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setAuthMsg({ text: err.message || "Google authentication failed.", type: "error" });
      setGoogleLoading(false);
    }
  };

  const handleSignup = async () => {
    if (!form.name || !form.email || !form.password || !form.company) {
      setAuthMsg({ text: "Please fill in all required fields.", type: "error" });
      return;
    }
    setAuthSubmitting(true);
    setAuthMsg(null);
    try {
      const profileFields = {
        name: form.name,
        company: form.company,
        role: form.role,
        sector: form.sector,
        phone: form.phone,
        linkedin: form.linkedin,
        bio: form.bio,
      };
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          // Kept in user metadata so the profile can be created after email confirmation
          data: profileFields,
          emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (error) throw error;

      if (data.user) {
        if (!data.session) {
          setScreen("check_email");
          setAuthSubmitting(false);
          return;
        }

        const { error: profileErr } = await supabase.from("profiles").upsert({ id: data.user.id, ...profileFields });
        if (profileErr) throw profileErr;

        triggerConfetti();
        await loadUserData(data.user.id, form.email);
      }
    } catch (err: any) {
      setAuthMsg({ text: err.message || "Signup failed.", type: "error" });
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleCompleteGoogleProfile = async () => {
    if (!form.company || !form.role || !currentUser?.id) {
      setAuthMsg({ text: "Please enter your company and role.", type: "error" });
      return;
    }
    setAuthSubmitting(true);
    try {
      const { error } = await supabase.from("profiles").upsert({
        id: currentUser.id,
        name: form.name || currentUser.name || "Networker",
        company: form.company,
        role: form.role,
        sector: form.sector || "Technology",
        phone: form.phone,
        linkedin: form.linkedin,
        bio: form.bio,
      });
      if (error) throw error;
      triggerConfetti();
      await loadUserData(currentUser.id, currentUser.email);
    } catch (err: any) {
      setAuthMsg({ text: err.message || "Failed to save profile.", type: "error" });
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogin = async () => {
    setAuthSubmitting(true);
    setAuthMsg(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginForm.email,
        password: loginForm.password,
      });
      if (error) {
        if (error.message.toLowerCase().includes("email not confirmed")) {
          throw new Error("Please confirm your email address before signing in.");
        }
        throw new Error("Invalid email or password.");
      }
      if (data.user && loadedUserRef.current !== data.user.id) {
        await loadUserData(data.user.id, data.user.email);
      }
    } catch (err: any) {
      setAuthMsg({ text: err.message || "Login failed.", type: "error" });
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail) {
      setAuthMsg({ text: "Please enter your email address.", type: "error" });
      return;
    }
    setAuthSubmitting(true);
    setAuthMsg(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      });
      if (error) throw error;
      setAuthMsg({ text: "Password reset link sent to your inbox.", type: "success" });
    } catch (err: any) {
      setAuthMsg({ text: err.message || "Failed to send reset link.", type: "error" });
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      setAuthMsg({ text: "Password must be at least 8 characters.", type: "error" });
      return;
    }
    setAuthSubmitting(true);
    setAuthMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      showToast("Password updated successfully!", "success");
      setScreen("login");
    } catch (err: any) {
      setAuthMsg({ text: err.message || "Failed to update password.", type: "error" });
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleFile = useCallback(
    async (file: any) => {
      if (!file?.type?.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = async (e: any) => {
        setScanPreview(e.target.result);
        setScanErr("");
        setScanning(true);
        try {
          const dataUrl = await downscaleImage(e.target.result);
          const mimeType = dataUrl.slice(5, dataUrl.indexOf(";")) || file.type;
          const base64 = dataUrl.split(",")[1];

          if (currentUser?.id) {
            await checkAndIncrementUsage(supabase, currentUser.id, "card_scan");
          }

          const [imageUrl, cardData] = await Promise.all([
            (async () => {
              if (!currentUser?.id) return dataUrl;
              const ext = mimeType.split("/")[1] || "jpg";
              const fileName = `${currentUser.id}/${Date.now()}.${ext}`;
              const blob = await fetch(dataUrl).then((r) => r.blob());
              const { error } = await supabase.storage
                .from("card-images")
                .upload(fileName, blob, { contentType: mimeType });
              if (error) {
                console.warn("Storage upload failed, falling back to data URL:", error.message);
                return dataUrl;
              }
              return supabase.storage.from("card-images").getPublicUrl(fileName).data.publicUrl;
            })(),
            extractCard(base64, mimeType),
          ]);

          setScanPreview(imageUrl);

          if (currentUser?.id) {
            await supabase.from("business_card_scans").insert({
              user_id: currentUser.id,
              image_data: imageUrl,
              extracted_data: cardData,
            });
          }

          if (cardData) {
            triggerConfetti();
            setAddForm((f) => ({
              ...f,
              name: cardData.name || "",
              title: cardData.title || "",
              company: cardData.company || "",
              email: cardData.email || "",
              phone: cardData.phone || "",
              website: cardData.website || "",
              linkedin: cardData.linkedin || "",
            }));
            setAddStep("preview");
            setTab("add");
          } else {
            setScanErr("Could not read card details. Try a clearer photo.");
          }
        } catch (err: any) {
          console.error("Extraction error:", err);
          setScanErr(err.message || "Extraction failed. Check your connection.");
        } finally {
          setScanning(false);
        }
      };
      reader.readAsDataURL(file);
    },
    [currentUser]
  );

  const handleQrFile = useCallback(async (file: any) => {
    if (!file?.type?.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      setScanning(true);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const jsQR = require("jsqr");
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        setScanning(false);
        if (code) {
          try {
            const data = JSON.parse(code.data);
            if (!data || typeof data !== "object") throw new Error("not a profile");
            // Only accept known string fields from an untrusted QR payload
            const fields = ["name", "title", "company", "email", "phone", "website", "linkedin"] as const;
            const picked: Record<string, string> = {};
            for (const k of fields) {
              if (typeof data[k] === "string") picked[k] = data[k].slice(0, 300);
            }
            if (!picked.name) throw new Error("missing name");
            triggerConfetti();
            setAddForm((f) => ({ ...f, ...picked }));
            setAddStep("preview");
            setTab("add");
          } catch {
            showToast("QR code found but could not read a NetworQ profile.", "error");
          }
        } else {
          showToast("No QR code detected. Try a clearer image.", "error");
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }, [showToast]);

  const saveContact = async () => {
    setSaving(true);
    setSaveErr("");
    try {
      const { data, error } = await supabase
        .from("contacts")
        .insert({
          user_id: currentUser.id,
          name: addForm.name,
          title: addForm.title || null,
          company: addForm.company || null,
          email: addForm.email || null,
          phone: addForm.phone || null,
          website: addForm.website || null,
          linkedin: addForm.linkedin || null,
          event: addForm.event || null,
          reference: addForm.reference || null,
          reminder: addForm.reminder || null,
          reminder_date: addForm.reminderDate || null,
          image: scanPreview,
          reminder_done: false,
          email_sent: false,
          tags: addForm.tags || [],
        })
        .select()
        .single();
      if (error) throw error;
      const newContact = dbToContact(data);
      setContacts((prev) => [newContact, ...prev]);
      setAddForm({
        name: "",
        title: "",
        roleCategory: "Founder",
        company: "",
        email: "",
        phone: "",
        website: "",
        linkedin: "",
        event: "",
        reference: "",
        reminder: "",
        reminderDate: "",
        tags: [],
        notes: "",
      });
      setTagInput("");
      setScanPreview(null);
      setAddStep("form");
      setTab("contacts");
      setModal(newContact);
      triggerConfetti();
      showToast("Contact saved successfully!", "success");
    } catch (err: any) {
      console.error("saveContact exception:", err);
      setSaveErr(err.message || "Failed to save contact.");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (contact: any) => {
    setEditingContact(contact);
    setAddForm({
      name: contact.name || "",
      title: contact.title || "",
      roleCategory: contact.roleCategory || getContactRoleCategory(contact) || "Founder",
      company: contact.company || "",
      email: contact.email || "",
      phone: contact.phone || "",
      website: contact.website || "",
      linkedin: contact.linkedin || "",
      event: contact.event || "",
      reference: contact.reference || "",
      reminder: contact.reminder || "",
      reminderDate: contact.reminderDate || "",
      tags: contact.tags || [],
      notes: contact.notes || "",
    });
    setTagInput("");
    setScanPreview(contact.image || null);
    setAddStep("form");
    setSaveErr("");
    setModal(null);
    setTab("add");
  };

  const updateContact = async () => {
    setSaving(true);
    setSaveErr("");
    try {
      const { data, error } = await supabase
        .from("contacts")
        .update({
          name: addForm.name,
          title: addForm.title || null,
          company: addForm.company || null,
          email: addForm.email || null,
          phone: addForm.phone || null,
          website: addForm.website || null,
          linkedin: addForm.linkedin || null,
          event: addForm.event || null,
          reference: addForm.reference || null,
          reminder: addForm.reminder || null,
          reminder_date: addForm.reminderDate || null,
          tags: addForm.tags || [],
        })
        .eq("id", editingContact.id)
        .select()
        .single();
      if (error) throw error;
      const updated = dbToContact(data);
      setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditingContact(null);
      setAddForm({
        name: "",
        title: "",
        roleCategory: "Founder",
        company: "",
        email: "",
        phone: "",
        website: "",
        linkedin: "",
        event: "",
        reference: "",
        reminder: "",
        reminderDate: "",
        tags: [],
        notes: "",
      });
      setTagInput("");
      setScanPreview(null);
      setAddStep("form");
      setTab("contacts");
      setModal(updated);
      showToast("Contact updated!", "success");
    } catch (err: any) {
      console.error("updateContact exception:", err);
      setSaveErr(err.message || "Failed to update contact.");
    } finally {
      setSaving(false);
    }
  };

  const openEmail = async (contact: any, angle?: string) => {
    setEmailModal(contact);
    setEmailSent(false);
    setGeneratedEmail("");
    setGeneratingEmail(true);
    try {
      if (currentUser?.id) {
        await checkAndIncrementUsage(supabase, currentUser.id, "email_generation");
      }
      const text = await genIntroEmail(currentUser, contact, angle);
      setGeneratedEmail(text);
    } catch (err: any) {
      setGeneratedEmail("");
      showToast(err.message || "Failed to generate email.", "error");
    } finally {
      setGeneratingEmail(false);
    }
  };

  const generateAIPrepBrief = async (contact: any) => {
    setPrepLoading(true);
    setPrepBrief(null);
    try {
      const prompt = `Prepare a concise executive networking dossier on ${contact.name} (${contact.title || ""} at ${contact.company || ""}) for ${currentUser?.name} (${currentUser?.role} at ${currentUser?.company}).
Include:
1. 🎯 Strategic Talking Points (2 bullets)
2. 💡 Potential Synergy / Collaboration Angle
3. ☕ High-impact conversation starter questions.
Keep it punchy, sharp, and directly actionable.`;
      const brief = await callAI([{ role: "user", content: prompt }], "You are a top-tier executive networking strategist.", {
        max_tokens: 500,
        action: "chat",
      });
      setPrepBrief(brief);
      triggerConfetti();
    } catch (err: any) {
      showToast(err.message || "Failed to generate briefing.", "error");
    } finally {
      setPrepLoading(false);
    }
  };

  const toggleVoiceNote = () => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Speech recognition is not supported in this browser.", "error");
      return;
    }

    if (isRecordingVoice) {
      setIsRecordingVoice(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => setIsRecordingVoice(true);
    recognition.onend = () => setIsRecordingVoice(false);
    recognition.onerror = () => setIsRecordingVoice(false);
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      if (transcript) {
        setAddForm((f) => ({
          ...f,
          reference: f.reference ? `${f.reference}\n[Voice Note]: ${transcript}` : `[Voice Note]: ${transcript}`,
        }));
        showToast("Voice note transcribed!", "success");
      }
    };
    recognition.start();
  };

  const sendEmail = async () => {
    if (!emailModal?.email) {
      showToast("This contact has no email address.", "error");
      return;
    }
    setEmailSending(true);
    try {
      const { subject, body } = parseEmailDraft(generatedEmail);
      await sendEmailViaServer({
        to: emailModal.email,
        subject,
        body,
        fromName: currentUser?.name || "",
        replyTo: currentUser?.email || "",
      });
      await supabase.from("follow_up_emails").insert({
        user_id: currentUser?.id,
        contact_id: emailModal.id,
        draft: generatedEmail,
        sent: true,
        sent_at: new Date().toISOString(),
      });
      await supabase.from("contacts").update({ email_sent: true }).eq("id", emailModal.id);
      setContacts((prev) => prev.map((c) => (c.id === emailModal.id ? { ...c, emailSent: true } : c)));
      setEmailSent(true);
      triggerConfetti();
      showToast(`Email sent to ${emailModal.email}`, "success");
      setTimeout(() => setEmailModal(null), 2000);
    } catch (err: any) {
      console.error("Email send error:", err);
      showToast(err?.text || err?.message || "Failed to send email.", "error");
    } finally {
      setEmailSending(false);
    }
  };

  const sendMeeting = async () => {
    if (!meetModal?.email) {
      showToast("This contact has no email address.", "error");
      return;
    }
    setMeetSending(true);
    try {
      const meetDateStr = meetDetails.date + " " + meetDetails.time;
      let link = "";
      const useGCal =
        !!process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID &&
        process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID !== "your_google_client_id";

      let calendarInviteSent = false;
      if (useGCal) {
        try {
          const result = await createCalendarEvent({
            title: `Meeting with ${meetModal.name}`,
            description: meetDetails.notes || `Scheduled via NetworQ by ${currentUser?.name}`,
            date: meetDetails.date,
            time: meetDetails.time,
            attendeeEmail: meetModal.email,
          });
          link = result.meetLink;
          calendarInviteSent = true;
        } catch (calErr: any) {
          console.warn("Calendar invite failed, falling back to email invite:", calErr?.message);
        }
      }

      if (!calendarInviteSent || !link) {
        link = link || genMeetLink();
        const messageBody = [
          `Hi ${meetModal.name},`,
          "",
          `I'd like to schedule a meeting with you.`,
          "",
          `Date: ${meetDetails.date}`,
          `Time: ${meetDetails.time}`,
          `Video call: ${link}`,
          meetDetails.notes ? `\nAgenda:\n${meetDetails.notes}` : "",
          "",
          `Looking forward to connecting!`,
          "",
          currentUser?.name,
        ].join("\n");

        await sendEmailViaServer({
          to: meetModal.email,
          subject: `Meeting invite from ${currentUser?.name} — ${meetDetails.date} at ${meetDetails.time}`,
          body: messageBody,
          fromName: currentUser?.name || "",
          replyTo: currentUser?.email || "",
        });
      }

      await supabase.from("meetings").insert({
        user_id: currentUser?.id,
        contact_id: meetModal.id,
        meet_link: link,
        meet_date: meetDetails.date,
        meet_time: meetDetails.time,
        notes: meetDetails.notes || null,
      });
      await supabase.from("contacts").update({ meet_link: link, meet_date: meetDateStr }).eq("id", meetModal.id);
      setContacts((prev) => prev.map((c) => (c.id === meetModal.id ? { ...c, meetLink: link, meetDate: meetDateStr } : c)));
      setMeetSent(true);
      triggerConfetti();
      showToast(calendarInviteSent ? `Calendar invite sent to ${meetModal.email}` : `Meeting invite sent to ${meetModal.email}`, "success");
      setTimeout(() => {
        setMeetModal(null);
        setMeetSent(false);
        setMeetDetails({ date: "", time: "", notes: "" });
      }, 2000);
    } catch (err: any) {
      console.error("Meeting invite error:", err);
      showToast(err?.text || err?.message || "Failed to send invite.", "error");
    } finally {
      setMeetSending(false);
    }
  };

  const toggleReminder = async (id: string) => {
    const contact = contacts.find((c) => c.id === id);
    if (!contact) return;
    const newVal = !contact.reminderDone;
    const { error } = await supabase.from("contacts").update({ reminder_done: newVal }).eq("id", id);
    if (error) {
      showToast(error.message || "Failed to update reminder.", "error");
      return;
    }
    const updated = contacts.map((c) => (c.id === id ? { ...c, reminderDone: newVal } : c));
    setContacts(updated);
    if (modal?.id === id) setModal(updated.find((c) => c.id === id));
    if (newVal) triggerConfetti();
  };

  const deleteContact = async (id: string) => {
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) {
      showToast(error.message || "Failed to delete contact.", "error");
      return;
    }
    setContacts((prev) => prev.filter((c) => c.id !== id));
    setModal(null);
    showToast("Contact deleted.", "success");
  };

  const exportCSV = () => {
    const cols = [
      "name",
      "title",
      "company",
      "email",
      "phone",
      "website",
      "linkedin",
      "event",
      "reference",
      "reminder",
      "reminderDate",
      "tags",
      "addedAt",
      "meetLink",
      "meetDate",
    ];
    const headers = [
      "Name",
      "Title",
      "Company",
      "Email",
      "Phone",
      "Website",
      "LinkedIn",
      "Event",
      "Reference",
      "Reminder",
      "Reminder Date",
      "Tags",
      "Added At",
      "Meet Link",
      "Meet Date",
    ];
    const escape = (v: any) => {
      const s = Array.isArray(v) ? v.join("; ") : String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [headers.join(","), ...filtered.map((c) => cols.map((k) => escape(c[k])).join(","))];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `networq-contacts-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    triggerConfetti();
  };

  const accountApi = useMemo(() => createAccountApi(supabase, apiBase(AI_PROXY)), []);

  const openProfileModal = () => setTab("settings");

  const handleSignedOut = useCallback(
    (message?: string) => {
      loadedUserRef.current = null;
      setCurrentUser(null);
      setContacts([]);
      setTab("contacts");
      setScreen("login");
      // Toasts only render inside the app shell — show it on the sign-in screen instead
      setAuthMsg(message ? { text: message, type: "success" } : null);
    },
    []
  );

  const getContactRoleCategory = useCallback((c: any): string => {
    if (c.roleCategory) return c.roleCategory;
    const text = `${c.title || ""} ${c.role || ""} ${(c.tags || []).join(" ")}`.toLowerCase();
    if (text.includes("founder") || text.includes("co-founder") || text.includes("ceo") || text.includes("creator")) {
      return "Founders";
    }
    if (text.includes("invest") || text.includes("angel") || text.includes("vc") || text.includes("venture") || text.includes("capital") || text.includes("fund")) {
      return "Investors";
    }
    if (text.includes("vp") || text.includes("director") || text.includes("chief") || text.includes("head") || text.includes("executive") || text.includes("president") || text.includes("manager")) {
      return "Executives";
    }
    if (text.includes("engineer") || text.includes("dev") || text.includes("tech") || text.includes("architect") || text.includes("cto") || text.includes("coder") || text.includes("software")) {
      return "Engineers";
    }
    if (text.includes("design") || text.includes("ux") || text.includes("ui") || text.includes("creative") || text.includes("art")) {
      return "Designers";
    }
    if (text.includes("consult") || text.includes("advisor") || text.includes("coach") || text.includes("strategist") || text.includes("agency") || text.includes("marketing") || text.includes("growth")) {
      return "Consultants";
    }
    return "Other";
  }, []);

  const openBulkFollowUpModal = () => {
    const withEmail = effectiveContacts.filter((c) => c.email);
    if (!withEmail.length) {
      showToast("No contacts with email addresses available.", "error");
      return;
    }
    const unemailed = withEmail.filter((c) => !c.emailSent);
    const targets = unemailed.length > 0 ? unemailed : withEmail;

    const drafts = targets.map((c) => {
      const draft = generateExecutiveFollowUp(currentUser, c);
      return {
        contact: c,
        subject: draft.subject,
        body: draft.body,
        status: "ready" as const,
      };
    });
    setBulkDrafts(drafts);
    setBulkEmailModalOpen(true);
  };

  const sendAllBulkEmails = async () => {
    if (!bulkDrafts.length || bulkSending) return;
    setBulkSending(true);
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < bulkDrafts.length; i++) {
      const draft = bulkDrafts[i];
      if (draft.status === "sent") continue;

      setBulkDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, status: "sending" } : d)));

      try {
        if (!draft.contact.email) throw new Error("Contact has no email address.");
        await sendEmailViaServer({
          to: draft.contact.email,
          subject: draft.subject,
          body: draft.body,
          fromName: currentUser?.name || "",
          replyTo: currentUser?.email || "",
        });
        if (draft.contact.id) {
          await supabase.from("contacts").update({ email_sent: true }).eq("id", draft.contact.id);
        }
        setContacts((prev) => prev.map((c) => (c.id === draft.contact.id ? { ...c, emailSent: true } : c)));
        setBulkDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, status: "sent" } : d)));
        sentCount++;
      } catch (err: any) {
        console.warn("Bulk email failed for", draft.contact.name, err);
        setBulkDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, status: "ready" } : d)));
        failedCount++;
      }
    }
    setBulkSending(false);
    if (sentCount > 0) triggerConfetti();
    if (failedCount === 0) {
      showToast(`Sent ${sentCount} follow-up email${sentCount === 1 ? "" : "s"}.`, "success");
    } else {
      showToast(`Sent ${sentCount}, failed ${failedCount}. Failed emails can be retried.`, "error");
    }
  };

  const isMobile =
    windowWidth < 880 ||
    (typeof window !== "undefined" && window.screen && window.screen.width < 880) ||
    (typeof navigator !== "undefined" &&
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent));
  const effectiveContacts = contacts;

  const greetingText = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return "Good morning,";
    if (hr < 18) return "Good afternoon,";
    return "Good evening,";
  }, []);

  const selectedContact = useMemo(() => {
    return effectiveContacts.find((c) => c.id === selectedContactId) || effectiveContacts[0] || null;
  }, [effectiveContacts, selectedContactId]);

  const allTags = useMemo(() => [...new Set(effectiveContacts.flatMap((c) => c.tags || []))].sort(), [effectiveContacts]);
  const today = new Date().toISOString().slice(0, 10);
  const dueReminders = useMemo(
    () => effectiveContacts.filter((c) => c.reminder && c.reminderDate && !c.reminderDone && c.reminderDate <= today),
    [effectiveContacts, today]
  );

  const momentumScore = useMemo(() => {
    if (!effectiveContacts.length) return 20;
    const base = Math.min(60, effectiveContacts.length * 5);
    const emailsCount = effectiveContacts.filter((c) => c.emailSent).length * 8;
    const meetsCount = effectiveContacts.filter((c) => c.meetLink).length * 10;
    return Math.min(99, base + emailsCount + meetsCount);
  }, [effectiveContacts]);

  const filtered = useMemo(() => {
    return effectiveContacts
      .filter(
        (c) =>
          !searchQ ||
          [c.name, c.company, c.title, c.event, c.email, c.reference].some((v) =>
            v?.toLowerCase().includes(searchQ.toLowerCase())
          )
      )
      .filter((c) => !selectedTag || (c.tags || []).includes(selectedTag))
      .filter((c) => {
        if (selectedRole === "all") return true;
        return getContactRoleCategory(c).toLowerCase() === selectedRole.toLowerCase();
      })
      .sort((a, b) => {
        const va = a[sortCol] || "";
        const vb = b[sortCol] || "";
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      });
  }, [effectiveContacts, searchQ, selectedTag, selectedRole, sortCol, sortDir, getContactRoleCategory]);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const themeStyles = useMemo(() => {
    if (isDark) {
      return {
        bg: "#000000",
        text: "#F5F5F7",
        textMuted: "#86868B",
        glassCard: {
          background: "#161617",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.5)",
          color: "#F5F5F7",
        },
        glassNav: {
          background: "rgba(22, 22, 23, 0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
        },
        input: {
          background: "rgba(255, 255, 255, 0.06)",
          border: "1px solid rgba(255, 255, 255, 0.16)",
          color: "#F5F5F7",
        },
        accentBtn: {
          background: "#2997FF",
          color: "#FFFFFF",
          boxShadow: "0 2px 8px rgba(41, 151, 255, 0.3)",
        },
        btnOutline: {
          background: "transparent",
          color: "#F5F5F7",
          border: "1px solid rgba(255, 255, 255, 0.2)",
        },
        tableHeader: {
          background: "rgba(255, 255, 255, 0.03)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          color: "#86868B",
        },
        tableRowBorder: "rgba(255, 255, 255, 0.08)",
        subtleBg: "rgba(255, 255, 255, 0.04)",
      };
    } else {
      return {
        bg: "#F5F5F7",
        text: "#1D1D1F",
        textMuted: "#6E6E73",
        glassCard: {
          background: "#FFFFFF",
          border: "1px solid #E5E5EA",
          boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.04)",
          color: "#1D1D1F",
        },
        glassNav: {
          background: "rgba(255, 255, 255, 0.88)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid #E5E5EA",
        },
        input: {
          background: "#FFFFFF",
          border: "1px solid #D2D2D7",
          color: "#1D1D1F",
        },
        accentBtn: {
          background: "#0071E3",
          color: "#FFFFFF",
          boxShadow: "0 2px 6px rgba(0, 113, 227, 0.2)",
        },
        btnOutline: {
          background: "#FFFFFF",
          color: "#1D1D1F",
          border: "1px solid #D2D2D7",
        },
        tableHeader: {
          background: "#F5F5F7",
          borderBottom: "1px solid #E5E5EA",
          color: "#6E6E73",
        },
        tableRowBorder: "#E5E5EA",
        subtleBg: "#F5F5F7",
      };
    }
  }, [isDark]);

  const CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      width: 100%;
      overflow-y: auto !important;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      letter-spacing: -0.012em;
      -webkit-font-smoothing: antialiased;
      background-color: ${isDark ? "#000000" : "#F5F5F7"};
    }
    
    @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes spin { to { transform: rotate(360deg); } }

    input:focus, textarea:focus, select:focus {
      border-color: ${isDark ? "#2997FF" : "#0071E3"} !important;
      box-shadow: 0 0 0 3px ${isDark ? "rgba(41, 151, 255, 0.25)" : "rgba(0, 113, 227, 0.2)"} !important;
      outline: none;
    }
    
    .nav-pill {
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .nav-pill:hover {
      background: ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)"} !important;
    }
    
    .glass-card-hover {
      transition: all 0.2s ease;
    }
    .glass-card-hover:hover {
      transform: translateY(-1px);
      box-shadow: ${isDark ? "0 8px 24px rgba(0,0,0,0.5)" : "0 8px 20px rgba(0,0,0,0.06)"} !important;
      border-color: ${isDark ? "rgba(255,255,255,0.22)" : "#D2D2D7"} !important;
    }

    .table-row-hover {
      transition: background 0.15s ease;
    }
    .table-row-hover:hover {
      background: ${isDark ? "rgba(255,255,255,0.04)" : "#FAFAFC"} !important;
      cursor: pointer;
    }
    
    .btn-press:active {
      transform: scale(0.98);
    }
    
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-thumb { background: ${isDark ? "rgba(255,255,255,0.15)" : "#CBD5E1"}; border-radius: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
  `;

  const S = useMemo(
    () => ({
      page: {
        minHeight: "100vh",
        width: "100%",
        background: themeStyles.bg,
        color: themeStyles.text,
        fontFamily: "'Poppins', -apple-system, BlinkMacSystemFont, sans-serif",
        position: "relative" as const,
        overflowX: "hidden" as const,
      },
      card: {
        borderRadius: 14,
        padding: 24,
        ...themeStyles.glassCard,
      },
      btn: {
        border: "none",
        borderRadius: 10,
        padding: "10px 18px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        ...themeStyles.accentBtn,
        transition: "all 0.15s ease",
      },
      btnOutline: {
        borderRadius: 10,
        padding: "9px 16px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        ...themeStyles.btnOutline,
        transition: "all 0.15s ease",
      },
      btnSm: {
        border: "none",
        borderRadius: 8,
        padding: "7px 14px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        ...themeStyles.accentBtn,
      },
      btnSmOut: {
        borderRadius: 8,
        padding: "6px 12px",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        ...themeStyles.btnOutline,
      },
      input: {
        width: "100%",
        borderRadius: 9,
        padding: "10px 14px",
        fontSize: 13,
        boxSizing: "border-box" as const,
        transition: "border 0.2s ease",
        ...themeStyles.input,
      },
      label: {
        fontSize: 12,
        fontWeight: 600,
        color: themeStyles.text,
        marginBottom: 6,
        display: "block",
        letterSpacing: "-0.01em",
      },
    }),
    [themeStyles]
  );

  const renderBackgroundOrbs = () => null;

  if (screen === "splash") {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{CSS}</style>
        {renderBackgroundOrbs()}
        <div style={{ textAlign: "center", zIndex: 1, animation: "fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1)", padding: 24 }}>
          {/* Prominent Signature Purple Logo with Laser Scanner inside Q */}
          <div
            style={{
              margin: "0 auto 24px",
              display: "inline-flex",
              padding: 22,
              borderRadius: 32,
              background: isDark ? "rgba(124, 58, 237, 0.1)" : "rgba(124, 58, 237, 0.06)",
              border: isDark ? "1px solid rgba(124, 58, 237, 0.25)" : "1px solid rgba(124, 58, 237, 0.18)",
              boxShadow: "0 24px 48px rgba(124, 58, 237, 0.16)",
            }}
          >
            <Icons.Logo size={88} color="#7C3AED" scanning={true} />
          </div>

          <div style={{ margin: "0 auto 10px" }}>
            <Icons.Wordmark size={44} isDark={isDark} scanning={true} />
          </div>

          {/* High-tech Loading Progress Bar */}
          <div style={{ marginTop: 28, width: 240, margin: "28px auto 0" }}>
            <div
              style={{
                width: "100%",
                height: 6,
                borderRadius: 980,
                background: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${splashProgress}%`,
                  borderRadius: 980,
                  background: "linear-gradient(90deg, #7C3AED, #6366F1, #2997FF)",
                  transition: "width 0.25s ease-out",
                  boxShadow: "0 0 12px rgba(124, 58, 237, 0.6)",
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 10,
                fontSize: 11,
                color: themeStyles.textMuted,
                fontWeight: 600,
              }}
            >
              <span>{splashProgress < 75 ? "Loading NetworQ…" : "Ready…"}</span>
              <span style={{ color: isDark ? "#A78BFA" : "#7C3AED" }}>{splashProgress}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "check_email") {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{CSS}</style>
        {renderBackgroundOrbs()}
        <div style={{ width: "100%", maxWidth: 440, zIndex: 1, animation: "fadeUp 0.4s ease" }}>
          <div style={{ ...S.card, textAlign: "center", padding: 36 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(99, 102, 241, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
              <Icons.Mail size={26} color="#6366F1" />
            </div>
            <h2 style={{ fontFamily: "'Poppins', sans-serif", fontSize: 26, marginBottom: 8 }}>Verify your email</h2>
            <p style={{ color: themeStyles.textMuted, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              A confirmation link was sent to <strong style={{ color: themeStyles.text }}>{form.email}</strong>. Open the link to activate your workspace.
            </p>
            <button style={{ ...S.btn, width: "100%" }} onClick={() => { setScreen("login"); setAuthMsg(null); }}>
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "complete_profile") {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{CSS}</style>
        {renderBackgroundOrbs()}
        <div style={{ width: "100%", maxWidth: 480, zIndex: 1, animation: "fadeUp 0.4s ease" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <Icons.Logo size={40} style={{ margin: "0 auto 12px" }} />
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 28 }}>Complete Profile</div>
            <div style={{ color: themeStyles.textMuted, marginTop: 4, fontSize: 14 }}>
              Set up your professional card details
            </div>
          </div>
          <div style={S.card}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Full Name</label>
                <input
                  style={S.input}
                  placeholder="Priya Sharma"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label style={S.label}>Company *</label>
                <input
                  style={S.input}
                  placeholder="Acme Corp"
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Role / Title *</label>
                <input
                  style={S.input}
                  placeholder="Founder, Lead Architect"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                />
              </div>
              <div>
                <label style={S.label}>Sector</label>
                <select
                  style={S.input}
                  value={form.sector}
                  onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))}
                >
                  <option value="">Select industry…</option>
                  {SECTORS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Phone</label>
                <input
                  style={S.input}
                  placeholder="+1 (555) 019-2834"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div>
                <label style={S.label}>LinkedIn</label>
                <input
                  style={S.input}
                  placeholder="linkedin.com/in/username"
                  value={form.linkedin}
                  onChange={(e) => setForm((f) => ({ ...f, linkedin: e.target.value }))}
                />
              </div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={S.label}>Company Pitch / Bio</label>
              <textarea
                style={{ ...S.input, height: 75, resize: "none" }}
                placeholder="Brief one-line summary of what your company builds…"
                value={form.bio}
                onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              />
            </div>
            {authMsg && (
              <div
                style={{
                  color: authMsg.type === "error" ? "#ef4444" : "#10b981",
                  fontSize: 13,
                  marginBottom: 14,
                  background: authMsg.type === "error" ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.1)",
                  border: `1px solid ${authMsg.type === "error" ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)"}`,
                  padding: "10px 14px",
                  borderRadius: 10,
                }}
              >
                {authMsg.text}
              </div>
            )}
            <button
              style={{ ...S.btn, width: "100%", opacity: authSubmitting ? 0.7 : 1 }}
              onClick={handleCompleteGoogleProfile}
              disabled={authSubmitting}
            >
              {authSubmitting ? "Saving Profile…" : "Complete Setup & Launch"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "reset_password") {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{CSS}</style>
        {renderBackgroundOrbs()}
        <div style={{ width: "100%", maxWidth: 400, zIndex: 1, animation: "fadeUp 0.4s ease" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <Icons.Logo size={40} style={{ margin: "0 auto 12px" }} />
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 28 }}>Create New Password</div>
            <div style={{ color: themeStyles.textMuted, marginTop: 4, fontSize: 14 }}>Enter your updated password</div>
          </div>
          <div style={S.card}>
            <div style={{ marginBottom: 18 }}>
              <label style={S.label}>New Password</label>
              <PasswordInput style={S.input} label="New password" autoComplete="new-password" placeholder="Min 8 characters" value={newPassword} onChange={setNewPassword} />
            </div>
            {authMsg && (
              <div
                style={{
                  color: authMsg.type === "error" ? "#ef4444" : "#10b981",
                  fontSize: 13,
                  marginBottom: 14,
                  background: authMsg.type === "error" ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.1)",
                  padding: "10px 14px",
                  borderRadius: 10,
                }}
              >
                {authMsg.text}
              </div>
            )}
            <button
              style={{ ...S.btn, width: "100%", opacity: authSubmitting ? 0.7 : 1 }}
              onClick={handleUpdatePassword}
              disabled={authSubmitting}
            >
              {authSubmitting ? "Updating…" : "Save New Password"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "forgot_password") {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{CSS}</style>
        {renderBackgroundOrbs()}
        <div style={{ width: "100%", maxWidth: 400, zIndex: 1, animation: "fadeUp 0.4s ease" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <Icons.Logo size={40} style={{ margin: "0 auto 12px" }} />
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 28 }}>Account Recovery</div>
            <div style={{ color: themeStyles.textMuted, marginTop: 4, fontSize: 14 }}>We'll send a password recovery email</div>
          </div>
          <div style={S.card}>
            <div style={{ marginBottom: 18 }}>
              <label style={S.label}>Email Address</label>
              <input
                style={S.input}
                type="email"
                placeholder="you@company.com"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
              />
            </div>
            {authMsg && (
              <div
                style={{
                  color: authMsg.type === "error" ? "#ef4444" : "#10b981",
                  fontSize: 13,
                  marginBottom: 14,
                  background: authMsg.type === "error" ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.1)",
                  border: `1px solid ${authMsg.type === "error" ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)"}`,
                  padding: "10px 14px",
                  borderRadius: 10,
                }}
              >
                {authMsg.text}
              </div>
            )}
            <button
              style={{ ...S.btn, width: "100%", opacity: authSubmitting ? 0.7 : 1 }}
              onClick={handleForgotPassword}
              disabled={authSubmitting}
            >
              {authSubmitting ? "Sending Link…" : "Send Reset Link"}
            </button>
            <div style={{ textAlign: "center", marginTop: 18, fontSize: 13, color: themeStyles.textMuted }}>
              Remember your password?{" "}
              <span
                style={{ color: "#6366f1", cursor: "pointer", fontWeight: 600 }}
                onClick={() => { setScreen("login"); setAuthMsg(null); }}
              >
                Sign In
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "login") {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{CSS}</style>
        <div style={{ width: "100%", maxWidth: 390, zIndex: 1, animation: "fadeUp 0.3s ease" }}>
          <div style={{ textAlign: "center", marginBottom: 26 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
              <Icons.Wordmark size={32} isDark={isDark} />
            </div>
            <div style={{ color: themeStyles.textMuted, fontSize: 13, fontWeight: 500 }}>
              Meet. Remember. Reconnect.
            </div>
          </div>

          <div style={S.card}>
            {GOOGLE_SIGNIN_AVAILABLE && (
            <>
            <button
              style={{
                ...S.btnOutline,
                width: "100%",
                marginBottom: 16,
                fontSize: 13,
                opacity: googleLoading ? 0.7 : 1,
              }}
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
            >
              <Icons.Google size={18} />
              <span>{googleLoading ? "Connecting…" : "Continue with Google"}</span>
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)" }} />
              <span style={{ fontSize: 11, color: themeStyles.textMuted, fontWeight: 700, letterSpacing: "0.05em" }}>OR</span>
              <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)" }} />
            </div>
            </>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Email Address</label>
              <input
                style={S.input}
                type="email"
                placeholder="name@company.com"
                value={loginForm.email}
                onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ ...S.label, marginBottom: 0 }}>Password</label>
                <span
                  style={{ fontSize: 12, color: "#6D35F5", cursor: "pointer", fontWeight: 600 }}
                  onClick={() => { setScreen("forgot_password"); setAuthMsg(null); }}
                >
                  Forgot?
                </span>
              </div>
              <PasswordInput
                style={S.input}
                label="Password"
                placeholder="••••••••"
                value={loginForm.password}
                onChange={(v) => setLoginForm((f) => ({ ...f, password: v }))}
                onEnter={handleLogin}
              />
            </div>

            {authMsg && (
              <div
                style={{
                  color: authMsg.type === "error" ? "#ef4444" : "#10b981",
                  fontSize: 13,
                  marginBottom: 14,
                  background: authMsg.type === "error" ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.1)",
                  border: `1px solid ${authMsg.type === "error" ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)"}`,
                  padding: "10px 14px",
                  borderRadius: 10,
                }}
              >
                {authMsg.text}
              </div>
            )}

            <button
              style={{ ...S.btn, width: "100%", marginTop: 6, opacity: authSubmitting ? 0.7 : 1 }}
              onClick={handleLogin}
              disabled={authSubmitting}
            >
              {authSubmitting ? "Authenticating…" : "Sign In"}
            </button>

            <div style={{ textAlign: "center", marginTop: 18, fontSize: 13, color: themeStyles.textMuted }}>
              Don't have an account?{" "}
              <span
                style={{ color: "#6D35F5", cursor: "pointer", fontWeight: 600 }}
                onClick={() => { setScreen("signup"); setSignupStep(1); setAuthMsg(null); }}
              >
                Create Account
              </span>
            </div>
            <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, color: themeStyles.textMuted }}>
              <a href="/privacy" style={{ color: themeStyles.textMuted }}>Privacy</a>
              {" · "}
              <a href="/terms" style={{ color: themeStyles.textMuted }}>Terms</a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "signup") {
    return (
      <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{CSS}</style>
        <div style={{ width: "100%", maxWidth: 440, zIndex: 1, animation: "fadeUp 0.3s ease" }}>
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
              <Icons.Wordmark size={30} isDark={isDark} />
            </div>
            <div style={{ color: themeStyles.textMuted, fontSize: 13 }}>Step {signupStep} of 2 · Create Your Account</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 10 }}>
              {[1, 2].map((s) => (
                <div
                  key={s}
                  style={{
                    width: 32,
                    height: 3,
                    borderRadius: 2,
                    background: s <= signupStep ? "#6D35F5" : isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
                    transition: "background 0.3s",
                  }}
                />
              ))}
            </div>
          </div>

          <div style={S.card}>
            {signupStep === 1 && (
              <>
                {GOOGLE_SIGNIN_AVAILABLE && (
                <>
                <button
                  style={{
                    ...S.btnOutline,
                    width: "100%",
                    marginBottom: 16,
                    fontSize: 14,
                    opacity: googleLoading ? 0.7 : 1,
                  }}
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading}
                >
                  <Icons.Google size={18} />
                  <span>{googleLoading ? "Connecting…" : "Sign up with Google"}</span>
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)" }} />
                  <span style={{ fontSize: 11, color: themeStyles.textMuted, fontWeight: 700, letterSpacing: "0.05em" }}>OR</span>
                  <div style={{ flex: 1, height: 1, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)" }} />
                </div>
                </>
                )}

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={S.label}>Full Name *</label>
                    <input
                      style={S.input}
                      placeholder="Priya Sharma"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={S.label}>Email Address *</label>
                    <input
                      style={S.input}
                      type="email"
                      placeholder="priya@acme.com"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Password *</label>
                  <PasswordInput
                    style={S.input}
                    label="Password"
                    autoComplete="new-password"
                    placeholder="Minimum 8 characters"
                    value={form.password}
                    onChange={(v) => setForm((f) => ({ ...f, password: v }))}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={S.label}>Phone</label>
                    <input
                      style={S.input}
                      placeholder="+1 (555) 019-2834"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={S.label}>LinkedIn</label>
                    <input
                      style={S.input}
                      placeholder="linkedin.com/in/username"
                      value={form.linkedin}
                      onChange={(e) => setForm((f) => ({ ...f, linkedin: e.target.value }))}
                    />
                  </div>
                </div>

                {authMsg && (
                  <div
                    style={{
                      color: authMsg.type === "error" ? "#ef4444" : "#10b981",
                      fontSize: 13,
                      marginBottom: 14,
                      background: authMsg.type === "error" ? "rgba(239, 68, 68, 0.1)" : "rgba(16, 185, 129, 0.1)",
                      border: `1px solid ${authMsg.type === "error" ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)"}`,
                      padding: "10px 14px",
                      borderRadius: 10,
                    }}
                  >
                    {authMsg.text}
                  </div>
                )}
                <button
                  style={{ ...S.btn, width: "100%" }}
                  onClick={() => {
                    if (!form.name.trim() || !form.email.trim() || !form.password) {
                      setAuthMsg({ text: "Please fill in your name, email and password.", type: "error" });
                    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
                      setAuthMsg({ text: "Please enter a valid email address.", type: "error" });
                    } else if (form.password.length < 8) {
                      setAuthMsg({ text: "Password must be at least 8 characters.", type: "error" });
                    } else {
                      setAuthMsg(null);
                      setSignupStep(2);
                    }
                  }}
                >
                  Continue →
                </button>
                <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: themeStyles.textMuted }}>
                  Already registered?{" "}
                  <span
                    style={{ color: "#6366f1", cursor: "pointer", fontWeight: 600 }}
                    onClick={() => { setScreen("login"); setAuthMsg(null); }}
                  >
                    Sign In
                  </span>
                </div>
              </>
            )}

            {signupStep === 2 && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={S.label}>Company *</label>
                    <input
                      style={S.input}
                      placeholder="Acme Corp"
                      value={form.company}
                      onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={S.label}>Role / Title *</label>
                    <input
                      style={S.input}
                      placeholder="Founder, Lead Architect"
                      value={form.role}
                      onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                    />
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Sector</label>
                  <select
                    style={S.input}
                    value={form.sector}
                    onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))}
                  >
                    <option value="">Select industry…</option>
                    {SECTORS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: 18 }}>
                  <label style={S.label}>Company Pitch (optional)</label>
                  <textarea
                    style={{ ...S.input, height: 75, resize: "none" }}
                    placeholder="What does your company do?"
                    value={form.bio}
                    onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                  />
                </div>

                {authMsg && (
                  <div
                    style={{
                      color: "#ef4444",
                      fontSize: 13,
                      marginBottom: 14,
                      background: "rgba(239, 68, 68, 0.1)",
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      padding: "10px 14px",
                      borderRadius: 10,
                    }}
                  >
                    {authMsg.text}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10 }}>
                  <button style={{ ...S.btnOutline, flex: 1 }} onClick={() => setSignupStep(1)}>
                    Back
                  </button>
                  <button
                    style={{ ...S.btn, flex: 2, opacity: authSubmitting ? 0.7 : 1 }}
                    onClick={handleSignup}
                    disabled={authSubmitting}
                  >
                    {authSubmitting ? "Creating…" : "Complete Registration"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const qrData = JSON.stringify({
    name: currentUser?.name,
    title: currentUser?.role,
    company: currentUser?.company,
    email: currentUser?.email,
    phone: currentUser?.phone,
    linkedin: currentUser?.linkedin,
  });

  return (
    <div style={S.page}>
      <style>{CSS}</style>
      {renderBackgroundOrbs()}

      {/* Confetti Overlay Canvas */}
      <canvas
        id="networq-confetti-canvas"
        style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }}
      />

      {/* NameDrop Beam Modal */}
      {nameDropOpen && (
        <NameDropModal user={currentUser} onClose={() => setNameDropOpen(false)} isDark={isDark} />
      )}

      {/* Cmd + K Command Palette */}
      <CommandPalette
        isOpen={commandOpen}
        onClose={() => setCommandOpen(false)}
        contacts={contacts}
        onSelectContact={(c) => setModal(c)}
        onAction={(t) => {
          setTab(t as any);
          if (t === "add") {
            setAddStep("form");
            setScanPreview(null);
            setEditingContact(null);
          }
        }}
        isDark={isDark}
        toggleTheme={toggleTheme}
      />

      {/* ── AUTHENTIC SAAS APP SHELL (Brand Identity Guideline Page 12) ── */}
      <div style={{ display: isMobile ? "block" : "flex", minHeight: "100vh", width: "100%" }}>
        {/* DESKTOP SIDEBAR */}
        {!isMobile && (
          <aside
            style={{
              width: 250,
              flexShrink: 0,
              background: isDark ? "#161617" : "#FFFFFF",
              borderRight: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#E5E5EA"}`,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "20px 14px",
              position: "sticky",
              top: 0,
              height: "100vh",
              boxSizing: "border-box",
              zIndex: 50,
            }}
          >
            <div>
              {/* Brand Wordmark & Version Pill */}
              <div
                style={{
                  padding: "0 10px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setTab("contacts");
                  setSelectedRole("all");
                  setSearchQ("");
                }}
              >
                <Icons.Wordmark size={24} isDark={isDark} />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: isDark ? "#2997FF" : "#0071E3",
                    background: isDark ? "rgba(41, 151, 255, 0.12)" : "rgba(0, 113, 227, 0.08)",
                    padding: "2px 7px",
                    borderRadius: 980,
                    letterSpacing: "0.02em",
                  }}
                >
                  2.0
                </span>
              </div>

              {/* SECTION: WORKSPACE */}
              <div style={{ fontSize: 11, fontWeight: 700, color: themeStyles.textMuted, padding: "8px 12px 6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Workspace
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {[
                  {
                    id: "contacts",
                    label: "All Contacts",
                    icon: Icons.Users,
                    count: contacts.length,
                    onClick: () => {
                      setTab("contacts");
                      setSelectedRole("all");
                      setSearchQ("");
                    },
                    isActive: tab === "contacts" && selectedRole === "all",
                  },
                  {
                    id: "roles",
                    label: "Roles & Taxonomy",
                    icon: Icons.Briefcase,
                    count: 6,
                    onClick: () => {
                      setTab("contacts");
                      if (selectedRole === "all") setSelectedRole("Founders");
                    },
                    isActive: tab === "contacts" && selectedRole !== "all",
                  },
                  {
                    id: "followups",
                    label: "1-Click Follow-ups",
                    icon: Icons.Clock,
                    count: dueReminders.length > 0 ? dueReminders.length : undefined,
                    badgeColor: "#FF3B30",
                    onClick: () => {
                      setTab("contacts");
                      openBulkFollowUpModal();
                    },
                    isActive: false,
                  },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={item.onClick}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "9px 12px",
                      borderRadius: 10,
                      border: "none",
                      fontSize: 13,
                      fontWeight: item.isActive ? 600 : 500,
                      cursor: "pointer",
                      background: item.isActive
                        ? isDark ? "rgba(255, 255, 255, 0.1)" : "#EBEBEF"
                        : "transparent",
                      color: item.isActive
                        ? isDark ? "#FFFFFF" : "#1D1D1F"
                        : themeStyles.textMuted,
                      textAlign: "left",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <item.icon size={17} color={item.isActive ? (isDark ? "#2997FF" : "#0071E3") : "currentColor"} />
                      <span>{item.label}</span>
                    </div>
                    {item.count !== undefined && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: 8,
                          background: item.badgeColor ? "rgba(255, 59, 48, 0.15)" : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                          color: item.badgeColor || themeStyles.textMuted,
                        }}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* SECTION: INTELLIGENCE & TOOLS */}
              <div style={{ fontSize: 11, fontWeight: 700, color: themeStyles.textMuted, padding: "16px 12px 6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Intelligence
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {[
                  {
                    id: "scan",
                    label: "Card Scanner",
                    icon: Icons.Scan,
                    onClick: () => {
                      setTab("scan");
                      setScanErr("");
                      setScanPreview(null);
                    },
                    isActive: tab === "scan",
                  },
                  {
                    id: "radar",
                    label: "Proximity Radar",
                    icon: Icons.Radar,
                    onClick: () => {
                      setTab("radar");
                      triggerConfetti();
                    },
                    isActive: tab === "radar",
                  },
                  {
                    id: "events",
                    label: "Events Hub",
                    icon: Icons.Calendar,
                    onClick: () => setTab("events"),
                    isActive: tab === "events",
                  },
                  {
                    id: "qr",
                    label: "Digital Pass",
                    icon: Icons.QrCode,
                    onClick: () => setTab("qr"),
                    isActive: tab === "qr",
                  },
                  {
                    id: "add",
                    label: "Add Contact",
                    icon: Icons.Plus,
                    onClick: () => {
                      setTab("add");
                      setAddStep("form");
                      setScanPreview(null);
                      setEditingContact(null);
                    },
                    isActive: tab === "add",
                  },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={item.onClick}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "9px 12px",
                      borderRadius: 10,
                      border: "none",
                      fontSize: 13,
                      fontWeight: item.isActive ? 600 : 500,
                      cursor: "pointer",
                      background: item.isActive
                        ? isDark ? "rgba(255, 255, 255, 0.1)" : "#EBEBEF"
                        : "transparent",
                      color: item.isActive
                        ? isDark ? "#FFFFFF" : "#1D1D1F"
                        : themeStyles.textMuted,
                      textAlign: "left",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <item.icon size={17} color={item.isActive ? (isDark ? "#2997FF" : "#0071E3") : "currentColor"} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Bottom Profile Card (DP) */}
            <div
              style={{
                paddingTop: 14,
                borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#E5E5EA"}`,
              }}
            >
              <div
                onClick={openProfileModal}
                title="Account Settings"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: 12,
                  cursor: "pointer",
                  background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                  transition: "background 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <ContactAvatar
                    name={currentUser?.name}
                    image={currentUser?.avatar_url || currentUser?.photo}
                    size={36}
                    radius={10}
                    isDark={isDark}
                  />
                  <div style={{ minWidth: 0, textAlign: "left" }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: themeStyles.text,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 130,
                      }}
                    >
                      {currentUser?.name || "Account"}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: themeStyles.textMuted,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 130,
                      }}
                    >
                      {currentUser?.company || currentUser?.email || "NetworQ Member"}
                    </div>
                  </div>
                </div>
                <Icons.Settings size={15} color={themeStyles.textMuted} />
              </div>
            </div>
          </aside>
        )}

        {/* RIGHT AREA: TOP HEADER + MAIN CONTENT */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* Top Header Bar */}
          <header
            style={{
              height: 60,
              borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#E5E7EB"}`,
              background: isDark ? "#0D1022" : "#FFFFFF",
              padding: isMobile ? "0 14px" : "0 28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              position: "sticky",
              top: 0,
              zIndex: 40,
            }}
          >
            {isMobile ? (
              <div style={{ cursor: "pointer" }} onClick={() => setTab("contacts")}>
                <Icons.Wordmark size={22} isDark={isDark} />
              </div>
            ) : (
              <div style={{ position: "relative", width: 340 }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: themeStyles.textMuted, display: "flex" }}>
                  <Icons.Search size={15} />
                </span>
                <input
                  placeholder="Search people, companies or notes…"
                  value={searchQ}
                  onChange={(e) => {
                    setSearchQ(e.target.value);
                    if (tab !== "contacts") setTab("contacts");
                  }}
                  style={{
                    ...S.input,
                    paddingLeft: 36,
                    paddingRight: 48,
                    fontSize: 13,
                    background: isDark ? "rgba(255,255,255,0.04)" : "#F8F9FA",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "#E5E7EB"}`,
                  }}
                />
                <button
                  onClick={() => setCommandOpen(true)}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    border: "none",
                    background: isDark ? "rgba(255,255,255,0.08)" : "#E5E7EB",
                    borderRadius: 5,
                    padding: "2px 5px",
                    fontSize: 10,
                    fontWeight: 700,
                    color: themeStyles.textMuted,
                    cursor: "pointer",
                  }}
                >
                  ⌘K
                </button>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setRemindersOpen((o) => !o)}
                title="Notifications & Reminders"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#E5E7EB"}`,
                  background: isDark ? "rgba(255,255,255,0.04)" : "#FFFFFF",
                  color: themeStyles.textMuted,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  position: "relative",
                }}
              >
                <Icons.Bell size={16} />
                {dueReminders.length > 0 && (
                  <span style={{ position: "absolute", top: 7, right: 7, width: 7, height: 7, borderRadius: "50%", background: "#FF3B30" }} />
                )}
              </button>

              <button
                onClick={toggleTheme}
                title={`Switch to ${isDark ? "Light" : "Dark"} mode`}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#E5E7EB"}`,
                  background: isDark ? "rgba(255,255,255,0.04)" : "#FFFFFF",
                  color: themeStyles.textMuted,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                {isDark ? <Icons.Sun size={16} /> : <Icons.Moon size={16} />}
              </button>

              {!isMobile && (
                <button
                  style={{ ...S.btn, padding: "7px 14px", fontSize: 13 }}
                  onClick={() => {
                    setTab("add");
                    setAddStep("form");
                    setScanPreview(null);
                  }}
                >
                  <Icons.Plus size={14} />
                  <span>Add Contact</span>
                </button>
              )}

              <div
                onClick={openProfileModal}
                title="Profile & Settings"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: 8,
                }}
              >
                <ContactAvatar name={currentUser?.name} image={currentUser?.avatar_url || currentUser?.photo} size={32} radius={16} isDark={isDark} />
                {!isMobile && (
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: themeStyles.text, lineHeight: 1.2 }}>
                      {currentUser?.name || "Member"}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  setCurrentUser(null);
                  setContacts([]);
                  setScreen("login");
                }}
                title="Sign out"
                style={{
                  ...S.btnSmOut,
                  padding: "6px 10px",
                  fontSize: 12,
                }}
              >
                Sign out
              </button>
            </div>
          </header>

          {/* MAIN CONTENT CONTAINER */}
          <div
            style={{
              flex: 1,
              padding: isMobile ? "16px 12px 100px" : "28px 36px 60px",
              maxWidth: 1280,
              width: "100%",
              margin: "0 auto",
              boxSizing: "border-box",
            }}
          >
        {/* ── CONTACTS TAB ── */}
        {currentUser?.deletion_scheduled_at && (
          <div
            role="alert"
            style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "0 auto 16px", maxWidth: 880, padding: "12px 16px", borderRadius: 16, background: "rgba(255,59,48,0.1)", border: "1px solid rgba(255,59,48,0.35)" }}
          >
            <div style={{ flex: "1 1 240px", fontSize: 14 }}>
              <strong>Your account is scheduled for deletion</strong> on {new Date(currentUser.deletion_scheduled_at).toLocaleDateString()}. All data will be permanently removed.
            </div>
            <button
              style={{ ...S.btn, minHeight: 44 }}
              onClick={async () => {
                try {
                  await accountApi.cancelDeletion();
                  setCurrentUser((u: any) => ({ ...u, deletion_scheduled_at: null }));
                  showToast("Deletion cancelled. Welcome back!", "success");
                } catch (err: any) {
                  showToast(err.message, "error");
                }
              }}
            >
              Cancel deletion
            </button>
          </div>
        )}

        {tab === "contacts" && (
          <div>
            {/* ── BRAND DASHBOARD BANNER (Brand Identity Guideline Page 12) ── */}
            <div
              style={{
                ...themeStyles.glassCard,
                borderRadius: 20,
                padding: isMobile ? "18px 20px" : "24px 30px",
                marginBottom: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                position: "relative",
                overflow: "hidden",
                border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.12)" : "#E5E5EA"}`,
                background: isDark ? "#161617" : "#FFFFFF",
              }}
            >
              <div>
                <h1 style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif", fontSize: isMobile ? 22 : 30, fontWeight: 700, margin: 0, color: themeStyles.text, letterSpacing: "-0.02em" }}>
                  {greetingText}
                </h1>
                <p style={{ color: themeStyles.textMuted, fontSize: isMobile ? 13 : 14, marginTop: 4, fontWeight: 500, margin: "6px 0 0" }}>
                  Stronger relationships build brighter opportunities.
                </p>
              </div>
              {!isMobile && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", color: isDark ? "#2997FF" : "#0071E3", textTransform: "uppercase" }}>
                    PEOPLE · POSSIBILITIES · PROGRESS
                  </div>
                  <div style={{ fontSize: 12, color: themeStyles.textMuted, marginTop: 4 }}>
                    Meaningful connections for a brighter tomorrow
                  </div>
                </div>
              )}
            </div>

            {/* ── KPI METRICS CARDS (Brand Identity Guideline Page 12) ── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
                gap: 14,
                marginBottom: 24,
              }}
            >
              {[
                { count: effectiveContacts.length, label: "People", icon: Icons.Users, color: isDark ? "#2997FF" : "#0071E3", bg: isDark ? "rgba(41, 151, 255, 0.12)" : "#EBF5FF" },
                { count: dueReminders.length, label: "Follow-ups", icon: Icons.Calendar, color: "#34C759", bg: isDark ? "rgba(52, 199, 89, 0.12)" : "#EAFBF0" },
                { count: effectiveContacts.filter((c) => (c.tags || []).some((t: string) => /opportunity|client|deal|investor/i.test(t))).length, label: "Opportunities", icon: Icons.Trending, color: "#FF9F0A", bg: isDark ? "rgba(255, 159, 10, 0.12)" : "#FFF8ED" },
                { count: effectiveContacts.filter((c) => (c.tags || []).some((t: string) => /intro|referral|partner/i.test(t))).length, label: "Introductions", icon: Icons.Handshake, color: "#BF5AF2", bg: isDark ? "rgba(191, 90, 242, 0.12)" : "#F8EFFF" },
              ].map((m) => (
                <div
                  key={m.label}
                  style={{
                    ...themeStyles.glassCard,
                    borderRadius: 16,
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'Poppins', sans-serif", color: themeStyles.text, lineHeight: 1.1 }}>
                      {m.count}
                    </div>
                    <div style={{ fontSize: 13, color: themeStyles.textMuted, marginTop: 4, fontWeight: 500 }}>
                      {m.label}
                    </div>
                  </div>
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      background: m.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <m.icon size={20} color={m.color} />
                  </div>
                </div>
              ))}
            </div>

            {/* ── MOBILE HERO BANNER (Brand Identity Guideline Page 9) ── */}
            {isMobile && (
              <div
                style={{
                  ...themeStyles.glassCard,
                  background: isDark ? "#1C1C1E" : "#FFFFFF",
                  borderRadius: 20,
                  padding: 18,
                  marginBottom: 20,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#E5E5EA"}`,
                }}
              >
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: themeStyles.text, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>
                    Build Relationships That Matter
                  </div>
                  <div style={{ fontSize: 12, color: themeStyles.textMuted, marginTop: 4, fontWeight: 500 }}>
                    Connect. Collaborate. Grow.
                  </div>
                </div>
                <button
                  onClick={() => { setTab("add"); setAddStep("form"); }}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: isDark ? "#2997FF" : "#0071E3",
                    color: "#fff",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(0, 113, 227, 0.25)",
                  }}
                >
                  <Icons.ArrowRight size={16} color="#fff" />
                </button>
              </div>
            )}

            {/* Split Layout Container (Left: Recent People, Right: Contact Detail Inspector) */}
            <div style={{ display: isMobile ? "block" : "flex", gap: 24, alignItems: "flex-start" }}>
              <div style={{ flex: isMobile ? "1" : "1 1 58%", minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 18,
                    flexWrap: "wrap",
                    gap: 14,
                  }}
                >
                  <div>
                    <h2 style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif", fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
                      Recent People
                    </h2>
                    <div style={{ color: themeStyles.textMuted, fontSize: 13, marginTop: 4 }}>
                      {effectiveContacts.length} connection{effectiveContacts.length === 1 ? "" : "s"} · Connection Health: <strong style={{ color: isDark ? "#2997FF" : "#0071E3" }}>{momentumScore}/100</strong>
                    </div>
                  </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", width: isMobile ? "100%" : "auto" }}>
                <div style={{ position: "relative", flex: isMobile ? "1" : "none" }}>
                  <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: themeStyles.textMuted, display: "flex" }}>
                    <Icons.Search size={15} />
                  </span>
                  <input
                    placeholder="Search by name, company, role…"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    style={{ ...S.input, width: isMobile ? "100%" : 240, paddingLeft: 38, fontSize: 13 }}
                  />
                  {searchQ && (
                    <span
                      onClick={() => setSearchQ("")}
                      style={{
                        position: "absolute",
                        right: 12,
                        top: "50%",
                        transform: "translateY(-50%)",
                        cursor: "pointer",
                        color: themeStyles.textMuted,
                        display: "flex",
                      }}
                    >
                      <Icons.Close size={15} />
                    </span>
                  )}
                </div>

                {!isMobile && (
                  <div
                    style={{
                      display: "flex",
                      background: isDark ? "rgba(255,255,255,0.06)" : "#EBEBEF",
                      borderRadius: 10,
                      padding: 3,
                    }}
                  >
                    {[
                      { m: "table", icon: Icons.Table, label: "Table" },
                      { m: "cards", icon: Icons.Grid, label: "Cards" },
                    ].map(({ m, icon: ModeIcon, label }) => (
                      <button
                        key={m}
                        title={`Switch to ${label} view`}
                        onClick={() => setViewMode(m as any)}
                        style={{
                          border: "none",
                          borderRadius: 8,
                          padding: "6px 10px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: viewMode === m ? (isDark ? "#2C2C2E" : "#fff") : "transparent",
                          color: viewMode === m ? (isDark ? "#fff" : "#0071E3") : themeStyles.textMuted,
                          boxShadow: viewMode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                        }}
                      >
                        <ModeIcon size={16} />
                      </button>
                    ))}
                  </div>
                )}

                <button
                  style={{
                    ...S.btn,
                    fontSize: 13,
                    padding: "9px 15px",
                    background: isDark ? "#2997FF" : "#0071E3",
                  }}
                  onClick={openBulkFollowUpModal}
                  title="Generate & Dispatch Automated Follow-ups"
                >
                  <Icons.Mail size={14} />
                  <span>{isMobile ? "Follow-ups" : "⚡ 1-Click Follow-ups"}</span>
                </button>

                {!contactsLoading && contacts.length > 0 && (
                  <button
                    style={{ ...S.btnOutline, fontSize: 13, padding: "9px 14px" }}
                    onClick={exportCSV}
                    title={`Export ${filtered.length} contacts`}
                  >
                    <Icons.Download size={14} />
                    {!isMobile && <span>Export ({filtered.length})</span>}
                  </button>
                )}

                <button
                  style={{ ...S.btn, fontSize: 13, padding: "9px 16px" }}
                  onClick={() => {
                    setTab("add");
                    setAddStep("form");
                    setScanPreview(null);
                  }}
                >
                  <Icons.Plus size={15} />
                  <span>{isMobile ? "Add" : "Add Contact"}</span>
                </button>
              </div>
            </div>

            {/* Apple Segmented Roles Filter Chips */}
            <div style={{ marginBottom: 16, overflowX: "auto", paddingBottom: 2 }}>
              <div
                style={{
                  display: "inline-flex",
                  background: isDark ? "rgba(255,255,255,0.06)" : "#EBEBEF",
                  borderRadius: 10,
                  padding: 3,
                  gap: 3,
                }}
              >
                {[
                  { id: "all", label: "All Roles" },
                  { id: "founders", label: "Founders" },
                  { id: "investors", label: "Investors" },
                  { id: "executives", label: "Executives" },
                  { id: "engineers", label: "Engineers" },
                  { id: "designers", label: "Designers" },
                  { id: "consultants", label: "Consultants" },
                ].map(({ id, label }) => {
                  const active = selectedRole.toLowerCase() === id.toLowerCase();
                  return (
                    <button
                      key={id}
                      onClick={() => setSelectedRole(id)}
                      style={{
                        border: "none",
                        borderRadius: 8,
                        padding: "6px 14px",
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        cursor: "pointer",
                        background: active ? (isDark ? "#2C2C2E" : "#FFFFFF") : "transparent",
                        color: active
                          ? isDark ? "#FFFFFF" : "#1D1D1F"
                          : isDark ? "#86868B" : "#6E6E73",
                        boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                        transition: "all 0.15s ease",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Reminders Banner */}
            {!contactsLoading && dueReminders.length > 0 && (
              <div
                style={{
                  background: isDark ? "rgba(245, 158, 11, 0.1)" : "rgba(254, 243, 199, 0.8)",
                  backdropFilter: "blur(16px)",
                  border: `1px solid ${isDark ? "rgba(245, 158, 11, 0.25)" : "rgba(252, 211, 77, 0.8)"}`,
                  borderRadius: 14,
                  padding: "12px 18px",
                  marginBottom: 18,
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  onClick={() => setRemindersOpen((o) => !o)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Icons.Bell size={16} color="#F59E0B" />
                    <span style={{ fontWeight: 700, fontSize: 13, color: isDark ? "#fbbf24" : "#b45309" }}>
                      {dueReminders.length} reminder{dueReminders.length > 1 ? "s" : ""} scheduled for today
                    </span>
                    <span style={{ fontSize: 12, color: isDark ? "#fcd34d" : "#d97706" }}>
                      {dueReminders.filter((c) => c.reminderDate < today).length > 0 &&
                        `· ${dueReminders.filter((c) => c.reminderDate < today).length} overdue`}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: isDark ? "#fcd34d" : "#d97706", fontWeight: 700 }}>
                    {remindersOpen ? "Hide" : "Show"}
                  </span>
                </div>

                {remindersOpen && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    {dueReminders.map((c) => {
                      const overdue = c.reminderDate < today;
                      return (
                        <div
                          key={c.id}
                          style={{
                            background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.9)",
                            borderRadius: 10,
                            padding: "8px 14px",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            cursor: "pointer",
                            border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.95)"}`,
                          }}
                          onClick={() => setModal(c)}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: themeStyles.text }}>{c.name}</div>
                            <div style={{ fontSize: 12, color: themeStyles.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {c.reminder}
                            </div>
                          </div>
                          <span
                            style={{
                              background: overdue ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)",
                              color: overdue ? "#ef4444" : "#f59e0b",
                              borderRadius: 6,
                              padding: "3px 8px",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {overdue ? `Overdue · ${c.reminderDate}` : "Due today"}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleReminder(c.id);
                            }}
                            style={{
                              ...S.btnSm,
                              background: "rgba(16, 185, 129, 0.15)",
                              color: "#10b981",
                              fontSize: 11,
                              padding: "4px 10px",
                              border: "1px solid rgba(16, 185, 129, 0.3)",
                            }}
                          >
                            Done
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tag Filter Pills */}
            {!contactsLoading && allTags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: themeStyles.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 4 }}>
                  Filter:
                </span>
                {allTags.map((tag) => {
                  const tc = tagColor(tag, isDark);
                  const active = selectedTag === tag;
                  return (
                    <span
                      key={tag}
                      onClick={() => setSelectedTag(active ? null : tag)}
                      style={{
                        background: active ? (isDark ? "#2997FF" : "#0071E3") : tc.bg,
                        color: active ? "#ffffff" : tc.color,
                        border: `1px solid ${active ? "transparent" : tc.border}`,
                        borderRadius: 14,
                        padding: "4px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span>{tag}</span>
                      {active && <Icons.Close size={12} />}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Contacts Table / Cards */}
            {contactsLoading ? (
              <div style={{ ...S.card, textAlign: "center", padding: "60px 20px" }}>
                <div style={{ width: 36, height: 36, border: `3px solid ${isDark ? "rgba(41, 151, 255, 0.2)" : "rgba(0, 113, 227, 0.2)"}`, borderTopColor: isDark ? "#2997FF" : "#0071E3", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 14px" }} />
                <div style={{ color: themeStyles.textMuted, fontSize: 13 }}>Loading relationships…</div>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", padding: "50px 20px" }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                  <img
                    src={searchQ ? "/illustrations/Search-Input/Search-Input-1.svg" : "/illustrations/Data-Table/Data-Table-1.svg"}
                    alt="Empty state"
                    style={{
                      width: 200,
                      height: 95,
                      objectFit: "contain",
                      filter: isDark ? "invert(0.85) hue-rotate(180deg) brightness(0.9)" : "none",
                      opacity: 0.9,
                    }}
                  />
                </div>
                <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
                  {searchQ ? "No matching contacts" : "No contacts in your network yet"}
                </div>
                <div style={{ fontSize: 13, color: themeStyles.textMuted }}>
                  {searchQ ? `No results found for "${searchQ}"` : "Scan a physical business card or add a contact manually."}
                </div>
                {!searchQ && (
                  <button style={{ ...S.btn, marginTop: 18 }} onClick={() => setTab("scan")}>
                    <Icons.Scan size={16} />
                    <span>Scan Business Card</span>
                  </button>
                )}
              </div>
            ) : viewMode === "table" && !isMobile ? (
              <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={themeStyles.tableHeader}>
                        {[
                          ["name", "Name"],
                          ["company", "Company"],
                          ["email", "Email"],
                          ["phone", "Phone"],
                          ["event", "Event & Tags"],
                          ["addedAt", "Created"],
                        ].map(([col, label]) => (
                          <th
                            key={col}
                            onClick={() => toggleSort(col)}
                            style={{
                              padding: "12px 16px",
                              textAlign: "left",
                              fontSize: 11,
                              fontWeight: 700,
                              color: sortCol === col ? "#6366f1" : themeStyles.textMuted,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              cursor: "pointer",
                              userSelect: "none",
                            }}
                          >
                            {label} {sortCol === col ? (sortDir === "asc" ? "↑" : "↓") : ""}
                          </th>
                        ))}
                        <th style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, color: themeStyles.textMuted, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c) => {
                        const av = avatar(c.name);
                        return (
                          <tr
                            key={c.id}
                            className="table-row-hover"
                            style={{ borderBottom: `1px solid ${themeStyles.tableRowBorder}` }}
                            onClick={() => setModal(c)}
                          >
                            <td style={{ padding: "12px 16px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <ContactAvatar contact={c} size={32} radius={9} isDark={isDark} />
                                <div>
                                  <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                                    {c.reminder && c.reminderDate && !c.reminderDone && c.reminderDate <= today && (
                                      <span
                                        title={c.reminderDate < today ? "Overdue reminder" : "Reminder due today"}
                                        style={{
                                          width: 7,
                                          height: 7,
                                          borderRadius: "50%",
                                          background: c.reminderDate < today ? "#ef4444" : "#f59e0b",
                                          flexShrink: 0,
                                        }}
                                      />
                                    )}
                                    {c.name || "—"}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                                    {c.title && <span style={{ fontSize: 11, color: themeStyles.textMuted }}>{c.title}</span>}
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontWeight: 500,
                                        padding: "2px 7px",
                                        borderRadius: 6,
                                        background: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)",
                                        color: isDark ? "#AEAEB2" : "#6E6E73",
                                        border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"}`,
                                      }}
                                    >
                                      {getContactRoleCategory(c)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: "12px 16px", fontWeight: 500 }}>
                              {c.company || <span style={{ color: themeStyles.textMuted, opacity: 0.4 }}>—</span>}
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              {c.email ? (
                                <a
                                  href={`mailto:${c.email}`}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ color: isDark ? "#2997FF" : "#0071E3", textDecoration: "none", fontSize: 12, fontWeight: 500 }}
                                >
                                  {c.email}
                                </a>
                              ) : (
                                <span style={{ color: themeStyles.textMuted, opacity: 0.4 }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: "12px 16px", color: themeStyles.textMuted, fontSize: 12 }}>
                              {c.phone || <span style={{ opacity: 0.4 }}>—</span>}
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              {c.event && (
                                <span
                                  style={{
                                    background: isDark ? "rgba(99, 102, 241, 0.15)" : "rgba(99, 102, 241, 0.1)",
                                    color: "#818cf8",
                                    borderRadius: 6,
                                    padding: "2px 8px",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    display: "inline-block",
                                    marginBottom: 3,
                                  }}
                                >
                                  {c.event}
                                </span>
                              )}
                              {(c.tags || []).length > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                                  {(c.tags || []).map((t: string) => {
                                    const tc = tagColor(t, isDark);
                                    return (
                                      <span
                                        key={t}
                                        style={{
                                          background: tc.bg,
                                          color: tc.color,
                                          borderRadius: 6,
                                          padding: "1px 6px",
                                          fontSize: 10,
                                          fontWeight: 600,
                                        }}
                                      >
                                        {t}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                              {!c.event && !(c.tags || []).length && <span style={{ color: themeStyles.textMuted, opacity: 0.4 }}>—</span>}
                            </td>
                            <td style={{ padding: "12px 16px", color: themeStyles.textMuted, fontSize: 11 }}>
                              {c.addedAt ? new Date(c.addedAt).toLocaleDateString() : "—"}
                            </td>
                            <td style={{ padding: "12px 16px" }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  className="btn-press"
                                  onClick={() => openEmail(c)}
                                  style={{ ...S.btnSm, padding: "5px 9px", fontSize: 11 }}
                                  title="Draft AI Email"
                                >
                                  <Icons.Mail size={13} />
                                </button>
                                <button
                                  className="btn-press"
                                  onClick={() => { setMeetModal(c); setMeetSent(false); }}
                                  style={{ ...S.btnSm, background: "rgba(16, 185, 129, 0.15)", color: "#10b981", padding: "5px 9px", fontSize: 11 }}
                                  title="Schedule Meeting"
                                >
                                  <Icons.Calendar size={13} />
                                </button>
                                <button
                                  className="btn-press"
                                  onClick={() => openEdit(c)}
                                  style={{ ...S.btnSmOut, padding: "5px 9px", fontSize: 11 }}
                                  title="Edit Contact"
                                >
                                  <Icons.Edit size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
                {filtered.map((c) => {
                  const av = avatar(c.name);
                  return (
                    <div
                      key={c.id}
                      className="glass-card-hover"
                      style={{ ...S.card, padding: 20, cursor: "pointer", position: "relative" }}
                      onClick={() => setModal(c)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <ContactAvatar contact={c} size={42} radius={12} isDark={isDark} />
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                            {c.reminder && c.reminderDate && !c.reminderDone && c.reminderDate <= today && (
                              <span
                                title={c.reminderDate < today ? "Overdue reminder" : "Reminder due today"}
                                style={{ width: 7, height: 7, borderRadius: "50%", background: c.reminderDate < today ? "#ef4444" : "#f59e0b", flexShrink: 0 }}
                              />
                            )}
                            {c.name}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                            <span style={{ fontSize: 12, color: themeStyles.textMuted }}>
                              {[c.title, c.company].filter(Boolean).join(" · ")}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 500,
                                padding: "2px 7px",
                                borderRadius: 6,
                                background: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)",
                                color: isDark ? "#AEAEB2" : "#6E6E73",
                                border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"}`,
                              }}
                            >
                              {getContactRoleCategory(c)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {c.email && (
                        <div style={{ fontSize: 12, color: isDark ? "#2997FF" : "#0071E3", marginBottom: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
                          <Icons.Mail size={12} color={isDark ? "#2997FF" : "#0071E3"} />
                          <span>{c.email}</span>
                        </div>
                      )}
                      {c.phone && (
                        <div style={{ fontSize: 12, color: themeStyles.textMuted, marginBottom: 5, display: "flex", alignItems: "center", gap: 6 }}>
                          <Icons.Phone size={12} />
                          <span>{c.phone}</span>
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 6, marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => openEmail(c)}
                          style={{ ...S.btnSm, flex: 1, fontSize: 11, padding: "7px 8px" }}
                        >
                          <Icons.Mail size={12} />
                          <span>Email</span>
                        </button>
                        <button
                          onClick={() => { setMeetModal(c); setMeetSent(false); }}
                          style={{ ...S.btnSm, background: "rgba(16, 185, 129, 0.15)", color: "#10b981", flex: 1, fontSize: 11, padding: "7px 8px" }}
                        >
                          <Icons.Calendar size={12} />
                          <span>Meet</span>
                        </button>
                        <button onClick={() => openEdit(c)} style={{ ...S.btnSmOut, padding: "7px 10px" }}>
                          <Icons.Edit size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN: SELECTED CONTACT DETAIL INSPECTOR (Brand Identity Guideline Page 12) ── */}
          {!isMobile && selectedContact && (
            <div
              style={{
                flex: "0 0 40%",
                maxWidth: 440,
                position: "sticky",
                top: 88,
                ...themeStyles.glassCard,
                borderRadius: 20,
                padding: 24,
                boxShadow: isDark
                  ? "0 20px 45px -10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)"
                  : "0 20px 45px -10px rgba(21, 26, 56, 0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(21, 26, 56, 0.08)"}`,
              }}
            >
              {/* Contact Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ position: "relative" }}>
                    <ContactAvatar contact={selectedContact} size={52} radius={14} isDark={isDark} />
                    <span
                      style={{
                        position: "absolute",
                        bottom: -2,
                        right: -2,
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: "#34C759",
                        border: `2px solid ${isDark ? "#161617" : "#fff"}`,
                      }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Poppins', sans-serif", color: themeStyles.text }}>
                      {selectedContact.name}
                    </div>
                    <div style={{ fontSize: 13, color: themeStyles.textMuted, marginTop: 2, fontWeight: 500 }}>
                      {[selectedContact.title, selectedContact.company].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    onClick={() => openEmail(selectedContact)}
                    style={{
                      ...themeStyles.accentBtn,
                      border: "none",
                      borderRadius: 10,
                      padding: "8px 16px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span>Connect</span>
                  </button>
                  <button
                    onClick={() => setModal(selectedContact)}
                    title="More options"
                    style={{
                      background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                      border: "none",
                      borderRadius: 10,
                      width: 34,
                      height: 34,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      color: themeStyles.textMuted,
                    }}
                  >
                    <Icons.Dots size={16} />
                  </button>
                </div>
              </div>

              {/* Detail Tabs */}
              <div
                style={{
                  display: "flex",
                  borderBottom: `1px solid ${themeStyles.tableRowBorder}`,
                  marginBottom: 16,
                  gap: 8,
                }}
              >
                {(["overview", "relationship", "notes", "opportunities"] as const).map((tabKey) => {
                  const isActive = activeDetailTab === tabKey;
                  const labels: Record<string, string> = {
                    overview: "Overview",
                    relationship: "Relationship",
                    notes: "Notes",
                    opportunities: "Opportunities",
                  };
                  return (
                    <button
                      key={tabKey}
                      onClick={() => setActiveDetailTab(tabKey)}
                      style={{
                        background: "none",
                        border: "none",
                        borderBottom: isActive ? `2px solid ${isDark ? "#2997FF" : "#0071E3"}` : "2px solid transparent",
                        padding: "8px 10px",
                        fontSize: 12,
                        fontWeight: isActive ? 700 : 500,
                        color: isActive ? (isDark ? "#ffffff" : "#0071E3") : themeStyles.textMuted,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {labels[tabKey]}
                    </button>
                  );
                })}
              </div>

              {/* Tab Content */}
              {activeDetailTab === "overview" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <p style={{ fontSize: 13, color: themeStyles.textMuted, lineHeight: 1.5, margin: 0 }}>
                    {selectedContact.bio || selectedContact.notes || "Designing intuitive experiences that bring people and ideas closer."}
                  </p>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
                    <div style={{ background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", borderRadius: 12, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11, color: themeStyles.textMuted, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                        <Icons.Send size={12} color={isDark ? "#2997FF" : "#0071E3"} /> Last connected
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: themeStyles.text, marginTop: 4 }}>
                        {selectedContact.lastConnected || "3 days ago"}
                      </div>
                    </div>

                    <div style={{ background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", borderRadius: 12, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11, color: themeStyles.textMuted, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                        <Icons.Calendar size={12} color="#10B981" /> Next follow-up
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: themeStyles.text, marginTop: 4 }}>
                        {selectedContact.followUpDue || "In 2 days"}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: themeStyles.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                      Shared Interests
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(selectedContact.sharedInterests || selectedContact.tags || ["Product", "Design", "Startups"]).map((tag: string) => (
                        <span
                          key={tag}
                          style={{
                            background: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)",
                            color: isDark ? "#AEAEB2" : "#6E6E73",
                            border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)"}`,
                            padding: "3px 9px",
                            borderRadius: 8,
                            fontSize: 11,
                            fontWeight: 500,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: themeStyles.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                      Notes
                    </div>
                    <div style={{ background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${themeStyles.tableRowBorder}`, borderRadius: 10, padding: 12, fontSize: 12, color: themeStyles.text, lineHeight: 1.5 }}>
                      {selectedContact.notes || "Great conversation about the future of collaborative tools."}
                    </div>
                  </div>
                </div>
              )}

              {activeDetailTab === "relationship" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ background: isDark ? "rgba(255, 255, 255, 0.04)" : "#F5F5F7", borderRadius: 12, padding: 14, border: `1px solid ${themeStyles.tableRowBorder}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: themeStyles.text, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Relationship Stages
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 10, textAlign: "center" }}>
                      <div style={{ background: "rgba(52, 199, 89, 0.15)", color: "#34C759", borderRadius: 8, padding: "6px 4px", fontSize: 11, fontWeight: 700 }}>
                        ✓ MEET
                      </div>
                      <div style={{ background: "rgba(52, 199, 89, 0.15)", color: "#34C759", borderRadius: 8, padding: "6px 4px", fontSize: 11, fontWeight: 700 }}>
                        ✓ REMEMBER
                      </div>
                      <div style={{ background: isDark ? "rgba(41, 151, 255, 0.2)" : "rgba(0, 113, 227, 0.12)", color: isDark ? "#2997FF" : "#0071E3", borderRadius: 8, padding: "6px 4px", fontSize: 11, fontWeight: 700 }}>
                        ➔ RECONNECT
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: 10, background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)" }}>
                    <span style={{ fontSize: 12, color: themeStyles.textMuted, fontWeight: 600 }}>Connection Health</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: isDark ? "#2997FF" : "#0071E3" }}>{selectedContact.momentum || 88}/100 · High Engagement</span>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button
                      onClick={() => { setMeetModal(selectedContact); setMeetSent(false); }}
                      style={{ ...S.btnSm, flex: 1, padding: "8px 12px", background: "rgba(16, 185, 129, 0.15)", color: "#10B981" }}
                    >
                      <Icons.Calendar size={13} />
                      <span>Schedule 1:1</span>
                    </button>
                    <button
                      onClick={() => downloadVCard(selectedContact)}
                      style={{ ...S.btnSmOut, padding: "8px 12px" }}
                      title="Download vCard"
                    >
                      <Icons.Download size={13} />
                    </button>
                  </div>
                </div>
              )}

              {activeDetailTab === "notes" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <textarea
                    defaultValue={selectedContact.notes || ""}
                    placeholder="Log conversation context or key takeaways…"
                    style={{ ...S.input, minHeight: 90, fontSize: 12, resize: "vertical" }}
                  />
                  <button
                    onClick={() => openEmail(selectedContact)}
                    style={{ ...S.btnSm, background: "linear-gradient(135deg, #7C43F8, #6D35F5)", color: "#fff", padding: "8px 14px" }}
                  >
                    <Icons.Sparkles size={13} />
                    <span>AI Follow-Up Assistant</span>
                  </button>
                </div>
              )}

              {activeDetailTab === "opportunities" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ padding: "12px 14px", borderRadius: 12, background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", border: `1px solid ${themeStyles.tableRowBorder}` }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: themeStyles.text }}>Product Design Advisory</div>
                    <div style={{ fontSize: 12, color: themeStyles.textMuted, marginTop: 3 }}>Potential advisory alignment for collaborative software tool stack.</div>
                  </div>
                  <div style={{ padding: "12px 14px", borderRadius: 12, background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", border: `1px solid ${themeStyles.tableRowBorder}` }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: themeStyles.text }}>Tech & Design Meetup Host</div>
                    <div style={{ fontSize: 12, color: themeStyles.textMuted, marginTop: 3 }}>Co-hosting community session during next tech week.</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )}

        {/* ── BUSINESS EVENTS HUB TAB ── */}
        {tab === "events" && (
          <EventsHub
            supabase={supabase}
            apiBaseUrl={apiBase(AI_PROXY)}
            isDark={isDark}
            showToast={showToast}
            onAttend={(ev) => {
              setRadarListedEvent({ externalId: ev.id, name: ev.title, venue: ev.venue, startsAt: ev.starts_at });
              setTab("radar");
            }}
            onAddContactForEvent={(eventName) => {
              setAddForm((f) => ({ ...f, event: eventName }));
              setTab("add");
              setAddStep("form");
            }}
          />
        )}

        {/* ── SETTINGS TAB ── */}
        {tab === "settings" && currentUser && (
          <SettingsScreen
            supabase={supabase}
            account={accountApi}
            currentUser={currentUser}
            isDark={isDark}
            showToast={showToast}
            onProfileUpdated={(patch) => setCurrentUser((u: any) => ({ ...u, ...patch }))}
            onSignedOut={handleSignedOut}
            onExportContacts={exportCSV}
          />
        )}

        {/* ── EVENT RADAR TAB ── */}
        {tab === "radar" && (
          <EventRadar
            supabase={supabase}
            isDark={isDark}
            showToast={showToast}
            onContactsChanged={() => currentUser?.id && loadUserData(currentUser.id, currentUser.email)}
            pendingJoinCode={radarJoinCode}
            pendingListedEvent={radarListedEvent}
            onPendingHandled={() => {
              setRadarJoinCode(null);
              setRadarListedEvent(null);
            }}
            onOpenEventsHub={() => setTab("events")}
          />
        )}

        {/* ── SCAN TAB ── */}
        {tab === "scan" && (
          <div style={{ maxWidth: 580, margin: "0 auto" }}>
            <LiveCameraModal
              isOpen={liveCameraOpen}
              onClose={() => setLiveCameraOpen(false)}
              onCapture={(f) => handleFile(f)}
              isDark={isDark}
            />

            <h2 style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif", fontSize: 28, marginBottom: 4, letterSpacing: "-0.02em" }}>
              Scan Business Card
            </h2>
            <p style={{ color: themeStyles.textMuted, fontSize: 13, marginBottom: 20 }}>
              Use your device camera or upload a business card photo to automatically extract contact details.
            </p>

            {/* Quick Action Camera Buttons */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <button
                onClick={() => cameraFileRef.current?.click()}
                style={{
                  padding: "14px 18px",
                  borderRadius: 14,
                  background: "linear-gradient(135deg, #0071E3, #2997FF)",
                  color: "#FFFFFF",
                  border: "none",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  boxShadow: "0 4px 14px rgba(0, 113, 227, 0.3)",
                }}
              >
                <Icons.Camera size={18} color="#FFFFFF" />
                <span>Open Device Camera</span>
              </button>

              <button
                onClick={() => setLiveCameraOpen(true)}
                style={{
                  padding: "14px 18px",
                  borderRadius: 14,
                  background: isDark ? "rgba(255, 255, 255, 0.08)" : "#F5F5F7",
                  color: isDark ? "#FFFFFF" : "#1D1D1F",
                  border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.15)" : "#E5E5EA"}`,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                <Icons.Scan size={18} color={isDark ? "#2997FF" : "#0071E3"} />
                <span>Live Viewfinder Scan</span>
              </button>
            </div>

            <div style={S.card}>
              <div
                style={{
                  border: `2px dashed ${isDark ? "rgba(255,255,255,0.15)" : "#D2D2D7"}`,
                  borderRadius: 14,
                  padding: "36px 20px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: isDark ? "rgba(255,255,255,0.02)" : "#FAFAFC",
                  transition: "all 0.2s ease",
                }}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFile(e.dataTransfer.files[0]);
                }}
              >
                {scanning ? (
                  <div>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        border: `3px solid ${isDark ? "rgba(41, 151, 255, 0.2)" : "rgba(0, 113, 227, 0.2)"}`,
                        borderTopColor: isDark ? "#2997FF" : "#0071E3",
                        borderRadius: "50%",
                        animation: "spin 0.8s linear infinite",
                        margin: "0 auto 14px",
                      }}
                    />
                    <div style={{ color: isDark ? "#2997FF" : "#0071E3", fontWeight: 600, fontSize: 14 }}>Scanning business card…</div>
                  </div>
                ) : scanPreview ? (
                  <img src={scanPreview} alt="preview" style={{ maxHeight: 200, borderRadius: 10, maxWidth: "100%", boxShadow: "0 6px 20px rgba(0,0,0,0.15)" }} />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <img
                      src="/illustrations/File-Upload/File-Upload-1.svg"
                      alt="Upload Illustration"
                      style={{
                        width: 170,
                        height: 85,
                        objectFit: "contain",
                        marginBottom: 10,
                        filter: isDark ? "invert(0.85) hue-rotate(180deg) brightness(0.9)" : "none",
                      }}
                    />
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, color: themeStyles.text }}>Choose from Gallery or Drop Card</div>
                    <div style={{ color: themeStyles.textMuted, fontSize: 12 }}>
                      or <span style={{ color: isDark ? "#2997FF" : "#0071E3", fontWeight: 600 }}>browse files</span> · PNG, JPG
                    </div>
                  </div>
                )}
              </div>

              {/* Native device camera input with capture attribute */}
              <input
                ref={cameraFileRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={(e: any) => handleFile(e.target.files[0])}
              />

              {/* Standard photo library input */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e: any) => handleFile(e.target.files[0])}
              />

              {scanErr && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "10px 14px",
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                    borderRadius: 10,
                    color: "#ef4444",
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Icons.AlertCircle size={15} />
                  <span>{scanErr}</span>
                  <button aria-label="Close"
                    onClick={() => { setScanErr(""); setScanPreview(null); }}
                    style={{ marginLeft: "auto", background: "none", border: "none", color: "#ef4444", cursor: "pointer", display: "flex" }}
                  >
                    <Icons.Close size={14} />
                  </button>
                </div>
              )}

              <div style={{ marginTop: 20, padding: 14, background: themeStyles.subtleBg, borderRadius: 12, textAlign: "center" }}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Or Scan a NetworQ QR Code</div>
                <button style={S.btnSm} onClick={() => qrFileRef.current?.click()}>
                  <Icons.QrCode size={14} />
                  <span>Upload QR Code</span>
                </button>
                <input ref={qrFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e: any) => handleQrFile(e.target.files[0])} />
              </div>
            </div>
          </div>
        )}

        {/* ── 3D MY QR PASS TAB ── */}
        {tab === "qr" && (
          <div style={{ maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
            <h2 style={{ fontFamily: "'Poppins', sans-serif", fontSize: 28, marginBottom: 4 }}>
              My NetworQ 3D Pass
            </h2>
            <p style={{ color: themeStyles.textMuted, fontSize: 13, marginBottom: 24 }}>
              Interactive 3D holographic digital business card. Real-time tilt and vCard export.
            </p>

            <HoloCard3D
              user={currentUser}
              qrData={qrData}
              isDark={isDark}
              onOpenNameDrop={() => setNameDropOpen(true)}
            />
          </div>
        )}

        {/* ── ADD CONTACT TAB ── */}
        {tab === "add" && (
          <div style={{ maxWidth: 620, margin: "0 auto" }}>
            <h2 style={{ fontFamily: "'Poppins', sans-serif", fontSize: 28, marginBottom: 4 }}>
              {editingContact ? "Edit Contact" : addStep === "form" ? "New Contact" : "Review Extracted Info"}
            </h2>
            <p style={{ color: themeStyles.textMuted, fontSize: 13, marginBottom: 20 }}>
              {editingContact ? "Update the contact record." : "Enter details manually or review extracted card data."}
            </p>

            <div style={S.card}>
              {scanPreview && (
                <div style={{ marginBottom: 16, textAlign: "center" }}>
                  <img src={scanPreview} alt="card" style={{ maxHeight: 130, borderRadius: 10, maxWidth: "100%" }} />
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={S.label}>Full Name *</label>
                  <input
                    style={S.input}
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Jane Doe"
                  />
                </div>
                <div>
                  <label style={S.label}>Job Title</label>
                  <input
                    style={S.input}
                    value={addForm.title}
                    onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="CEO, Founder, VP Engineering"
                  />
                </div>
                <div>
                  <label style={S.label}>Role Type *</label>
                  <select
                    style={S.input}
                    value={addForm.roleCategory || "Founders"}
                    onChange={(e) => setAddForm((f) => ({ ...f, roleCategory: e.target.value }))}
                  >
                    <option value="Founders">Founders</option>
                    <option value="Investors">Investors</option>
                    <option value="Executives">Executives</option>
                    <option value="Engineers">Engineers</option>
                    <option value="Designers">Designers</option>
                    <option value="Consultants">Consultants</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={S.label}>Company</label>
                  <input
                    style={S.input}
                    value={addForm.company}
                    onChange={(e) => setAddForm((f) => ({ ...f, company: e.target.value }))}
                    placeholder="Acme Corp"
                  />
                </div>
                <div>
                  <label style={S.label}>Email</label>
                  <input
                    style={S.input}
                    type="email"
                    value={addForm.email}
                    onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="jane@acme.com"
                  />
                </div>
                <div>
                  <label style={S.label}>Phone</label>
                  <input
                    style={S.input}
                    value={addForm.phone}
                    onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+1 555 123 4567"
                  />
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label style={S.label}>Website / Domain</label>
                    <button
                      type="button"
                      onClick={async () => {
                        const targetDomain = addForm.website || addForm.company;
                        if (!targetDomain) {
                          showToast("Enter a company name or website domain first.", "error");
                          return;
                        }
                        showToast("Scraping domain intelligence…", "success");
                        const intel = await enrichCompanyDomain(targetDomain);
                        if (intel) {
                          setAddForm((f) => ({
                            ...f,
                            website: f.website || intel.domain || "",
                            notes: (f.notes ? f.notes + "\n" : "") + (intel.description || intel.title || ""),
                            tags: [...new Set([...(f.tags || []), "enriched"])],
                          }));
                          showToast(`Enriched details from ${intel.domain || targetDomain}!`, "success");
                        } else {
                          showToast("Scraping lookup finished.", "info");
                        }
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: isDark ? "#2997FF" : "#0071E3",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      ⚡ Enrich Intel
                    </button>
                  </div>
                  <input
                    style={S.input}
                    value={addForm.website}
                    onChange={(e) => setAddForm((f) => ({ ...f, website: e.target.value }))}
                    placeholder="acme.com"
                  />
                </div>
                <div style={{ gridColumn: "1/-1" }}>
                  <label style={S.label}>LinkedIn</label>
                  <input
                    style={S.input}
                    value={addForm.linkedin}
                    onChange={(e) => setAddForm((f) => ({ ...f, linkedin: e.target.value }))}
                    placeholder="linkedin.com/in/jane"
                  />
                </div>
                <div style={{ gridColumn: "1/-1" }}>
                  <label style={S.label}>Notes & Context</label>
                  <textarea
                    style={{ ...S.input, height: 70, resize: "none", fontFamily: "inherit", fontSize: 13 }}
                    value={addForm.notes || ""}
                    onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Conversation notes, mutual connections, or project details…"
                  />
                </div>
              </div>

              {/* Tags */}
              <div style={{ borderTop: `1px solid ${themeStyles.tableRowBorder}`, paddingTop: 14, marginBottom: 14 }}>
                <label style={S.label}>Tags</label>
                {(addForm.tags || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                    {(addForm.tags || []).map((tag) => {
                      const tc = tagColor(tag, isDark);
                      return (
                        <span
                          key={tag}
                          style={{
                            background: tc.bg,
                            color: tc.color,
                            borderRadius: 12,
                            padding: "3px 10px",
                            fontSize: 11,
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span>{tag}</span>
                          <span
                            onClick={() => setAddForm((f) => ({ ...f, tags: (f.tags || []).filter((t) => t !== tag) }))}
                            style={{ cursor: "pointer", display: "flex" }}
                          >
                            <Icons.Close size={11} />
                          </span>
                        </span>
                      );
                    })}
                  </div>
                )}
                <input
                  style={{ ...S.input, fontSize: 13 }}
                  placeholder="Type a tag & press Enter (e.g. founder, investor, client…)"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                      e.preventDefault();
                      const t = tagInput.trim().toLowerCase().replace(/,/g, "");
                      if (t && !(addForm.tags || []).includes(t)) {
                        setAddForm((f) => ({ ...f, tags: [...(f.tags || []), t] }));
                      }
                      setTagInput("");
                    } else if (e.key === "Backspace" && !tagInput && (addForm.tags || []).length) {
                      setAddForm((f) => ({ ...f, tags: (f.tags || []).slice(0, -1) }));
                    }
                  }}
                />
              </div>

              {/* Event Context, Notes & Voice Note */}
              <div style={{ borderTop: `1px solid ${themeStyles.tableRowBorder}`, paddingTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: themeStyles.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Event & Follow-Up Context
                  </div>
                  <button
                    onClick={toggleVoiceNote}
                    style={{
                      ...S.btnSmOut,
                      fontSize: 11,
                      color: isRecordingVoice ? "#ef4444" : "#6366f1",
                      borderColor: isRecordingVoice ? "#ef4444" : "rgba(99, 102, 241, 0.3)",
                      background: isRecordingVoice ? "rgba(239, 68, 68, 0.1)" : "transparent",
                    }}
                  >
                    <Icons.Mic size={12} color={isRecordingVoice ? "#ef4444" : "#6366f1"} />
                    <span>{isRecordingVoice ? "Listening…" : "Voice Memo"}</span>
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={S.label}>Event Met At</label>
                    <input
                      style={S.input}
                      value={addForm.event}
                      onChange={(e) => setAddForm((f) => ({ ...f, event: e.target.value }))}
                      placeholder="TechSummit 2026"
                    />
                  </div>
                  <div>
                    <label style={S.label}>Reminder Date</label>
                    <input
                      style={S.input}
                      type="date"
                      value={addForm.reminderDate}
                      onChange={(e) => setAddForm((f) => ({ ...f, reminderDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Meeting Notes / Context</label>
                  <textarea
                    style={{ ...S.input, height: 65, resize: "none" }}
                    value={addForm.reference}
                    onChange={(e) => setAddForm((f) => ({ ...f, reference: e.target.value }))}
                    placeholder="Discussion notes, mutual interests, follow-up ideas…"
                  />
                </div>
                <div style={{ marginBottom: 18 }}>
                  <label style={S.label}>Follow-up Action</label>
                  <input
                    style={S.input}
                    value={addForm.reminder}
                    onChange={(e) => setAddForm((f) => ({ ...f, reminder: e.target.value }))}
                    placeholder="Send demo link next Tuesday"
                  />
                </div>
              </div>

              {saveErr && (
                <div style={{ marginBottom: 14, padding: "10px 14px", background: "rgba(239, 68, 68, 0.1)", borderRadius: 10, color: "#ef4444", fontSize: 12 }}>
                  {saveErr}
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                {editingContact && (
                  <button
                    style={{ ...S.btnOutline, flex: 1 }}
                    onClick={() => {
                      setEditingContact(null);
                      setAddStep("form");
                      setTab("contacts");
                    }}
                  >
                    Cancel
                  </button>
                )}
                <button
                  style={{ ...S.btn, flex: 2, opacity: !addForm.name || saving ? 0.6 : 1 }}
                  onClick={editingContact ? updateContact : saveContact}
                  disabled={!addForm.name || saving}
                >
                  <Icons.Check size={15} />
                  <span>{saving ? "Saving…" : editingContact ? "Update Contact" : "Save Contact"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
          </div>
        </div>
      </div>

      {/* ── DETAIL MODAL (WITH AI DOSSIER & ACTIONS) ── */}
      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            animation: "fadeIn 0.15s ease",
          }}
          onClick={() => {
            setModal(null);
            setPrepBrief(null);
          }}
        >
          <div
            style={{
              ...S.card,
              maxWidth: 540,
              width: "100%",
              maxHeight: "88vh",
              overflowY: "auto",
              animation: "fadeUp 0.2s ease",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <ContactAvatar contact={modal} size={50} radius={14} isDark={isDark} />
                <div>
                  <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 24 }}>{modal.name}</div>
                  <div style={{ color: themeStyles.textMuted, fontSize: 13, marginTop: 1 }}>
                    {[modal.title, modal.company].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setModal(null);
                  setPrepBrief(null);
                }}
                style={{ ...S.btnSmOut, padding: "6px 9px" }}
                title="Close"
                aria-label="Close"
              >
                <Icons.Close size={15} />
              </button>
            </div>

            {modal.image && (
              <img
                src={modal.image}
                alt="card"
                style={{ width: "100%", borderRadius: 10, marginBottom: 14, maxHeight: 180, objectFit: "cover" }}
              />
            )}

            {/* Executive Briefing Section */}
            <div style={{ background: isDark ? "rgba(41, 151, 255, 0.08)" : "rgba(0, 113, 227, 0.05)", border: `1px solid ${isDark ? "rgba(41, 151, 255, 0.2)" : "rgba(0, 113, 227, 0.15)"}`, borderRadius: 14, padding: "12px 16px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: prepBrief ? 8 : 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? "#2997FF" : "#0071E3", display: "flex", alignItems: "center", gap: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  <Icons.FileText size={14} color={isDark ? "#2997FF" : "#0071E3"} />
                  <span>EXECUTIVE BRIEFING & NOTES</span>
                </div>
                <button
                  onClick={() => generateAIPrepBrief(modal)}
                  disabled={prepLoading}
                  style={{
                    background: "none",
                    border: "none",
                    color: isDark ? "#2997FF" : "#0071E3",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {prepLoading ? "Analyzing…" : prepBrief ? "Re-generate" : "Generate Brief ⚡"}
                </button>
              </div>

              {prepBrief ? (
                <div style={{ fontSize: 12, lineHeight: 1.6, color: themeStyles.text, whiteSpace: "pre-wrap", borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`, paddingTop: 8 }}>
                  {prepBrief}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 4 }}>
                  <img
                    src="/illustrations/Split-Pages/Split-Pages-1.svg"
                    alt="Briefing illustration"
                    style={{
                      width: 58,
                      height: 28,
                      objectFit: "contain",
                      filter: isDark ? "invert(0.85) hue-rotate(180deg) brightness(0.9)" : "none",
                    }}
                  />
                  <div style={{ fontSize: 12, color: themeStyles.textMuted }}>
                    Generate structured talking points, past interaction history, and relationship notes.
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8, marginBottom: 14 }}>
              {[
                { label: "Email", val: modal.email, icon: Icons.Mail },
                { label: "Phone", val: modal.phone, icon: Icons.Phone },
                { label: "Website", val: modal.website, icon: Icons.Globe },
                { label: "LinkedIn", val: modal.linkedin, icon: Icons.Linkedin },
              ].map(({ label, val, icon: FieldIcon }) =>
                val ? (
                  <div key={label} style={{ background: themeStyles.subtleBg, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: themeStyles.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3, display: "flex", alignItems: "center", gap: 5 }}>
                      <FieldIcon size={11} />
                      <span>{label}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {val}
                    </div>
                  </div>
                ) : null
              )}
            </div>

            {modal.event && (
              <div style={{ background: "rgba(99, 102, 241, 0.1)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#818cf8", letterSpacing: "0.06em", textTransform: "uppercase" }}>EVENT</span>
                <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{modal.event}</div>
              </div>
            )}

            {(modal.tags || []).length > 0 && (
              <div style={{ background: themeStyles.subtleBg, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: themeStyles.textMuted, letterSpacing: "0.06em", textTransform: "uppercase" }}>TAGS</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  {(modal.tags || []).map((t: string) => {
                    const tc = tagColor(t, isDark);
                    return (
                      <span key={t} style={{ background: tc.bg, color: tc.color, borderRadius: 8, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}>
                        {t}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {modal.reference && (
              <div style={{ background: themeStyles.subtleBg, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: themeStyles.textMuted, letterSpacing: "0.06em", textTransform: "uppercase" }}>NOTES</span>
                <div style={{ marginTop: 3, fontSize: 13, lineHeight: 1.5 }}>{modal.reference}</div>
              </div>
            )}

            {modal.reminder && (
              <div style={{ background: "rgba(245, 158, 11, 0.1)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
                <div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.06em", textTransform: "uppercase" }}>REMINDER</span>
                  <div style={{ marginTop: 2, fontSize: 13 }}>
                    {modal.reminder} {modal.reminderDate && <span style={{ color: themeStyles.textMuted }}>· {modal.reminderDate}</span>}
                  </div>
                </div>
                <div
                  style={{
                    marginLeft: "auto",
                    cursor: "pointer",
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    border: `2px solid ${modal.reminderDone ? "#10b981" : "rgba(255,255,255,0.3)"}`,
                    background: modal.reminderDone ? "#10b981" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onClick={() => toggleReminder(modal.id)}
                >
                  {modal.reminderDone && <Icons.Check size={13} color="#fff" />}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button
                style={{ ...S.btn, flex: 1, fontSize: 12, padding: "9px 12px" }}
                onClick={() => { setModal(null); openEmail(modal); }}
              >
                <Icons.Mail size={13} />
                <span>Intro Email</span>
              </button>
              <button
                style={{ ...S.btn, background: "rgba(16, 185, 129, 0.15)", color: "#10b981", flex: 1, fontSize: 12, padding: "9px 12px" }}
                onClick={() => { setModal(null); setMeetModal(modal); setMeetSent(false); }}
              >
                <Icons.Calendar size={13} />
                <span>Meet</span>
              </button>
              <button
                style={{ ...S.btnSmOut, padding: "9px 12px" }}
                title="Download vCard (.vcf)"
                onClick={() => downloadVCard(modal)}
              >
                <Icons.Download size={13} />
              </button>
              <button style={S.btnSmOut} onClick={() => openEdit(modal)} title="Edit contact" aria-label="Edit contact">
                <Icons.Edit size={13} />
              </button>
              <button
                style={{
                  ...S.btnSmOut,
                  color: confirmDeleteId === modal.id ? "#FFFFFF" : "#ef4444",
                  background: confirmDeleteId === modal.id ? "#ef4444" : (S.btnSmOut as any).background,
                  borderColor: "rgba(239, 68, 68, 0.3)",
                }}
                title={confirmDeleteId === modal.id ? "Tap again to delete" : "Delete contact"}
                aria-label={confirmDeleteId === modal.id ? "Confirm delete" : "Delete contact"}
                onClick={() => {
                  if (confirmDeleteId === modal.id) {
                    setConfirmDeleteId(null);
                    deleteContact(modal.id);
                  } else {
                    setConfirmDeleteId(modal.id);
                  }
                }}
              >
                <Icons.Trash size={13} />
                {confirmDeleteId === modal.id && <span style={{ fontSize: 12, fontWeight: 600 }}>Confirm</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EMAIL MODAL ── */}
      {emailModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            zIndex: 350,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            animation: "fadeIn 0.15s ease",
          }}
          onClick={() => setEmailModal(null)}
        >
          <div style={{ ...S.card, maxWidth: 540, width: "100%", animation: "fadeUp 0.2s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 22 }}>Intro Email to {emailModal.name}</div>
              <button aria-label="Close" onClick={() => setEmailModal(null)} style={{ ...S.btnSmOut, padding: "5px 8px" }}>
                <Icons.Close size={15} />
              </button>
            </div>

            <div style={{ background: themeStyles.subtleBg, borderRadius: 10, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: themeStyles.textMuted }}>
              Recipient: <strong style={{ color: themeStyles.text }}>{emailModal.email || "(no email on record)"}</strong>
            </div>

            {generatingEmail ? (
              <div style={{ textAlign: "center", padding: "36px 0" }}>
                <div style={{ width: 34, height: 34, border: `3px solid ${isDark ? "rgba(41, 151, 255, 0.2)" : "rgba(0, 113, 227, 0.2)"}`, borderTopColor: isDark ? "#2997FF" : "#0071E3", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                <div style={{ color: isDark ? "#2997FF" : "#0071E3", fontWeight: 600, fontSize: 13 }}>Generating personalized follow-up draft…</div>
              </div>
            ) : emailSent ? (
              <div style={{ textAlign: "center", padding: "36px 0" }}>
                <Icons.CheckCircle size={44} style={{ margin: "0 auto 10px" }} />
                <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 22 }}>Email Sent</div>
                <div style={{ color: themeStyles.textMuted, marginTop: 4, fontSize: 13 }}>Delivered to {emailModal.email}</div>
              </div>
            ) : (
              <>
                <textarea
                  value={generatedEmail}
                  onChange={(e) => setGeneratedEmail(e.target.value)}
                  style={{ ...S.input, height: 210, resize: "none", fontSize: 13, lineHeight: 1.6, marginBottom: 14, fontFamily: "inherit" }}
                />
                <div style={{ display: "flex", gap: 10 }}>
                  <button style={{ ...S.btnOutline, flex: 1 }} onClick={() => openEmail(emailModal)} disabled={emailSending}>
                    Regenerate
                  </button>
                  <button style={{ ...S.btn, flex: 2, opacity: emailSending ? 0.6 : 1 }} onClick={sendEmail} disabled={emailSending}>
                    <Icons.Send size={14} />
                    <span>{emailSending ? "Sending…" : "Send Email"}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MEETING MODAL ── */}
      {meetModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            zIndex: 350,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            animation: "fadeIn 0.15s ease",
          }}
          onClick={() => setMeetModal(null)}
        >
          <div style={{ ...S.card, maxWidth: 460, width: "100%", animation: "fadeUp 0.2s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 22 }}>Schedule Meeting</div>
              <button aria-label="Close" onClick={() => setMeetModal(null)} style={{ ...S.btnSmOut, padding: "5px 8px" }}>
                <Icons.Close size={15} />
              </button>
            </div>

            {meetSent ? (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <Icons.CheckCircle size={44} style={{ margin: "0 auto 10px" }} />
                <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 22 }}>Invite Sent</div>
                <div style={{ color: themeStyles.textMuted, marginTop: 4, fontSize: 13 }}>Meeting invite delivered to {meetModal.email}</div>
              </div>
            ) : (
              <>
                <div style={{ background: themeStyles.subtleBg, borderRadius: 10, padding: "10px 12px", marginBottom: 14, fontSize: 12 }}>
                  Meeting with <strong>{meetModal.name}</strong> · <span style={{ color: themeStyles.textMuted }}>{meetModal.email}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={S.label}>Date</label>
                    <input style={S.input} type="date" value={meetDetails.date} onChange={(e) => setMeetDetails((d) => ({ ...d, date: e.target.value }))} />
                  </div>
                  <div>
                    <label style={S.label}>Time</label>
                    <input style={S.input} type="time" value={meetDetails.time} onChange={(e) => setMeetDetails((d) => ({ ...d, time: e.target.value }))} />
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>Agenda</label>
                  <textarea
                    style={{ ...S.input, height: 65, resize: "none" }}
                    value={meetDetails.notes}
                    onChange={(e) => setMeetDetails((d) => ({ ...d, notes: e.target.value }))}
                    placeholder="Key discussion topics…"
                  />
                </div>
                <div style={{ background: "rgba(99, 102, 241, 0.1)", borderRadius: 10, padding: "10px 12px", marginBottom: 16, fontSize: 12 }}>
                  <span style={{ color: "#818cf8", fontWeight: 700 }}>Video meeting link attached automatically</span>
                </div>
                <button
                  style={{ ...S.btn, width: "100%", opacity: !meetDetails.date || !meetDetails.time || meetSending ? 0.6 : 1 }}
                  onClick={sendMeeting}
                  disabled={!meetDetails.date || !meetDetails.time || meetSending}
                >
                  <Icons.Calendar size={14} />
                  <span>{meetSending ? "Sending…" : "Send Calendar Invite"}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── PROFILE MODAL ── */}

      {/* ── IPHONE FLOATING CURVED GLASS DOCK ── */}
      {isMobile && (
        <div
          style={{
            position: "fixed",
            bottom: "max(14px, env(safe-area-inset-bottom, 14px))",
            left: 14,
            right: 14,
            maxWidth: 440,
            margin: "0 auto",
            height: 64,
            background: isDark ? "rgba(18, 18, 24, 0.86)" : "rgba(255, 255, 255, 0.88)",
            backdropFilter: "blur(28px) saturate(190%)",
            WebkitBackdropFilter: "blur(28px) saturate(190%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 200,
            borderRadius: 36,
            border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.08)"}`,
            boxShadow: isDark
              ? "0 16px 36px rgba(0, 0, 0, 0.7), 0 2px 8px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.12)"
              : "0 16px 36px rgba(0, 0, 0, 0.14), 0 2px 8px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255,255,255,0.8)",
            padding: "4px 8px",
          }}
        >
          {[
            { t: "contacts", icon: Icons.Users, label: "Contacts" },
            { t: "events", icon: Icons.Calendar, label: "Events" },
            { t: "radar", icon: Icons.Radar, label: "Radar" },
            { t: "scan", icon: Icons.Scan, label: "Scan" },
            { t: "qr", icon: Icons.QrCode, label: "3D Pass" },
            { t: "add", icon: Icons.Plus, label: "Add" },
          ].map(({ t, icon: MobileIcon, label }) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => {
                  setTab(t as any);
                  if (t === "add") {
                    setAddStep("form");
                    setScanPreview(null);
                    setEditingContact(null);
                  }
                  if (t === "scan") {
                    setScanErr("");
                    setScanPreview(null);
                  }
                }}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                  border: "none",
                  background: active
                    ? (isDark ? "rgba(99, 102, 241, 0.2)" : "rgba(99, 102, 241, 0.12)")
                    : "transparent",
                  borderRadius: 22,
                  height: 52,
                  cursor: "pointer",
                  color: active ? (isDark ? "#818CF8" : "#4F46E5") : themeStyles.textMuted,
                  position: "relative",
                  transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                <MobileIcon size={18} color="currentColor" />
                <span style={{ fontSize: 10, fontWeight: active ? 700 : 500 }}>{label}</span>
                {t === "contacts" && dueReminders.length > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 10,
                      background: "#ef4444",
                      color: "#fff",
                      borderRadius: "50%",
                      width: 14,
                      height: 14,
                      fontSize: 8,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {dueReminders.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── 1-CLICK BULK AUTOMATED FOLLOW-UPS MODAL ── */}
      {bulkEmailModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            zIndex: 380,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            animation: "fadeIn 0.15s ease",
          }}
          onClick={() => !bulkSending && setBulkEmailModalOpen(false)}
        >
          <div
            style={{
              ...S.card,
              maxWidth: 680,
              width: "100%",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              padding: 24,
              animation: "fadeUp 0.2s ease",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <img
                  src="/illustrations/Bulk-Action/Bulk-Action-1.svg"
                  alt="Bulk Action"
                  style={{
                    width: 75,
                    height: 38,
                    objectFit: "contain",
                    filter: isDark ? "invert(0.85) hue-rotate(180deg) brightness(0.9)" : "none",
                  }}
                />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h3 style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif", fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
                      Automated Follow-ups
                    </h3>
                    <span
                      style={{
                        background: isDark ? "rgba(41, 151, 255, 0.15)" : "#EBF5FF",
                        color: isDark ? "#2997FF" : "#0071E3",
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 10,
                      }}
                    >
                      {bulkDrafts.length} ready
                    </span>
                  </div>
                  <p style={{ color: themeStyles.textMuted, fontSize: 13, marginTop: 4, margin: 0 }}>
                    Personalized follow-up drafts generated for all eligible contacts. Send all in 1-click or customize individually.
                  </p>
                </div>
              </div>

              <button aria-label="Close"
                onClick={() => setBulkEmailModalOpen(false)}
                disabled={bulkSending}
                style={{ ...S.btnSmOut, padding: "6px 8px" }}
              >
                <Icons.Close size={15} />
              </button>
            </div>

            {/* Drafts List */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 4, marginBottom: 18 }}>
              {bulkDrafts.map((d, idx) => (
                <div
                  key={d.contact.id || idx}
                  style={{
                    background: isDark ? "rgba(255,255,255,0.03)" : "#FAFAFC",
                    border: `1px solid ${themeStyles.tableRowBorder}`,
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: themeStyles.text }}>
                        {d.contact.name}
                        <span style={{ fontSize: 12, color: themeStyles.textMuted, fontWeight: 400, marginLeft: 8 }}>
                          {[d.contact.title, d.contact.company].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: isDark ? "#2997FF" : "#0071E3", marginTop: 2 }}>
                        {d.contact.email}
                      </div>
                    </div>

                    <div>
                      {d.status === "sent" ? (
                        <span style={{ background: "rgba(52, 199, 89, 0.15)", color: "#34C759", fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8, display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Icons.Check size={12} /> Sent
                        </span>
                      ) : d.status === "sending" ? (
                        <span style={{ color: isDark ? "#2997FF" : "#0071E3", fontSize: 11, fontWeight: 600 }}>
                          Dispatching…
                        </span>
                      ) : (
                        <a
                          href={`mailto:${d.contact.email}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 11,
                            color: themeStyles.textMuted,
                            textDecoration: "none",
                            padding: "4px 8px",
                            borderRadius: 6,
                            background: isDark ? "rgba(255,255,255,0.06)" : "#EBEBEF",
                          }}
                        >
                          Mail App ↗
                        </a>
                      )}
                    </div>
                  </div>

                  <input
                    style={{ ...S.input, fontSize: 12, padding: "6px 10px", marginBottom: 8, fontWeight: 600 }}
                    value={d.subject}
                    onChange={(e) => {
                      const newSub = e.target.value;
                      setBulkDrafts((prev) => prev.map((item, i) => (i === idx ? { ...item, subject: newSub } : item)));
                    }}
                    placeholder="Subject line"
                  />

                  <textarea
                    style={{ ...S.input, height: 75, resize: "none", fontSize: 12, lineHeight: 1.5, fontFamily: "inherit" }}
                    value={d.body}
                    onChange={(e) => {
                      const newBody = e.target.value;
                      setBulkDrafts((prev) => prev.map((item, i) => (i === idx ? { ...item, body: newBody } : item)));
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Modal Bottom Actions */}
            <div style={{ display: "flex", gap: 12, borderTop: `1px solid ${themeStyles.tableRowBorder}`, paddingTop: 14 }}>
              <button
                style={{ ...S.btnOutline, flex: 1 }}
                onClick={() => setBulkEmailModalOpen(false)}
                disabled={bulkSending}
              >
                Close
              </button>
              <button
                style={{
                  ...S.btn,
                  flex: 2,
                  background: isDark ? "#2997FF" : "#0071E3",
                  opacity: bulkSending ? 0.7 : 1,
                }}
                onClick={sendAllBulkEmails}
                disabled={bulkSending || bulkDrafts.every((d) => d.status === "sent")}
              >
                <Icons.Send size={14} />
                <span>
                  {bulkSending
                    ? "Dispatching Follow-ups…"
                    : bulkDrafts.every((d) => d.status === "sent")
                    ? "All Follow-ups Sent ✓"
                    : `⚡ Send All via Email (1-Click · ${bulkDrafts.filter((d) => d.status !== "sent").length})`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── NETWORQ AI & VOICE ASSISTANT (NetworQ Intelligence) ── */}
      {/* Floating Trigger Dock */}
      {!aiOpen && (
        <div
          style={{
            position: "fixed",
            bottom: isMobile ? 74 : 26,
            right: isMobile ? 16 : 28,
            zIndex: 850,
            animation: "fadeUp 0.3s ease",
          }}
        >
          <button
            onClick={() => setAiOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "10px 18px",
              borderRadius: 980,
              background: "linear-gradient(135deg, #7C3AED, #6366F1)",
              color: "#FFFFFF",
              border: "1px solid rgba(255, 255, 255, 0.25)",
              boxShadow: "0 10px 28px rgba(124, 58, 237, 0.35)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
              userSelect: "none",
            }}
          >
            <Icons.Logo size={18} color="#FFFFFF" scanning={true} />
            <span>AI & Voice</span>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ADE80", boxShadow: "0 0 6px #4ADE80" }} />
            <Icons.Mic size={14} color="#FFFFFF" />
          </button>
        </div>
      )}

      {/* Floating Assistant Window */}
      {aiOpen && (
        <div
          style={{
            position: "fixed",
            bottom: isMobile ? 70 : 26,
            right: isMobile ? 12 : 28,
            width: isMobile ? "calc(100% - 24px)" : 390,
            height: isMobile ? "calc(100vh - 140px)" : 560,
            maxHeight: 600,
            zIndex: 950,
            borderRadius: 22,
            background: isDark ? "rgba(22, 22, 23, 0.96)" : "rgba(255, 255, 255, 0.98)",
            backdropFilter: "blur(25px)",
            WebkitBackdropFilter: "blur(25px)",
            border: isDark ? "1px solid rgba(124, 58, 237, 0.3)" : "1px solid rgba(124, 58, 237, 0.2)",
            boxShadow: isDark
              ? "0 24px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(124, 58, 237, 0.2)"
              : "0 24px 60px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(124, 58, 237, 0.15)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "fadeUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Assistant Header */}
          <div
            style={{
              padding: "14px 16px",
              borderBottom: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: isDark ? "rgba(255, 255, 255, 0.02)" : "rgba(124, 58, 237, 0.03)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: isDark ? "rgba(124, 58, 237, 0.15)" : "rgba(124, 58, 237, 0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icons.Logo size={20} color="#7C3AED" scanning={true} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: themeStyles.text }}>NetworQ Assistant</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: isDark ? "#2997FF" : "#0071E3",
                      background: isDark ? "rgba(41, 151, 255, 0.12)" : "rgba(0, 113, 227, 0.08)",
                      padding: "1px 6px",
                      borderRadius: 980,
                    }}
                  >
                    AI Active
                  </span>
                </div>
                <div style={{ fontSize: 11, color: themeStyles.textMuted }}>Voice & Intelligence Engine</div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* TTS Voice Toggle Button */}
              <button
                onClick={toggleSpeechPlayback}
                title={voiceReplyEnabled ? "Disable Voice Audio Responses" : "Enable Voice Audio Responses"}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: voiceReplyEnabled
                    ? "rgba(124, 58, 237, 0.15)"
                    : isDark
                    ? "rgba(255, 255, 255, 0.06)"
                    : "rgba(0, 0, 0, 0.05)",
                  color: voiceReplyEnabled ? "#7C3AED" : themeStyles.textMuted,
                }}
              >
                {voiceReplyEnabled ? <Icons.Volume2 size={16} color="#7C3AED" /> : <Icons.VolumeX size={16} />}
              </button>

              {/* Close / Minimize Button */}
              <button
                onClick={() => {
                  setAiOpen(false);
                  if (typeof window !== "undefined" && "speechSynthesis" in window) {
                    window.speechSynthesis.cancel();
                  }
                  if (aiListening && speechRecRef.current) {
                    speechRecRef.current.stop();
                    setAiListening(false);
                  }
                }}
                title="Minimize Assistant"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.05)",
                  color: themeStyles.textMuted,
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Speaking Audio Wave Indicator */}
          {isSpeakingReply && (
            <div
              style={{
                padding: "6px 16px",
                background: "linear-gradient(90deg, rgba(124, 58, 237, 0.15), rgba(99, 102, 241, 0.15))",
                borderBottom: "1px solid rgba(124, 58, 237, 0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#7C3AED",
                fontWeight: 600,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ animation: "pulse 1s infinite", display: "inline-block" }}>●</span>
                <span>NetworQ AI Speaking...</span>
              </div>
              <button
                onClick={() => {
                  if (typeof window !== "undefined" && "speechSynthesis" in window) {
                    window.speechSynthesis.cancel();
                  }
                  setIsSpeakingReply(false);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#EF4444",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
              >
                Stop
              </button>
            </div>
          )}

          {/* Assistant Chat Message Stream */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {/* Quick Action Suggestion Chips */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: themeStyles.textMuted, marginBottom: 8 }}>
                Suggested Prompts:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[
                  "From whom should I send mails and reminders?",
                  "Who should I follow up with?",
                  "Find all Founders & Investors",
                  "Summarize network status",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendAiQuery(prompt)}
                    disabled={aiLoading}
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      padding: "5px 10px",
                      borderRadius: 980,
                      border: isDark ? "1px solid rgba(255, 255, 255, 0.1)" : "1px solid rgba(0, 0, 0, 0.08)",
                      background: isDark ? "rgba(255, 255, 255, 0.04)" : "#F5F5F7",
                      color: isDark ? "#E5E5EA" : "#1D1D1F",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            {/* Messages */}
            {aiMessages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: m.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                    background: m.role === "user"
                      ? "linear-gradient(135deg, #7C3AED, #6366F1)"
                      : isDark
                      ? "#242426"
                      : "#F0F0F2",
                    color: m.role === "user" ? "#FFFFFF" : isDark ? "#F5F5F7" : "#1D1D1F",
                    fontSize: 13,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    border: m.role === "user"
                      ? "none"
                      : isDark
                      ? "1px solid rgba(255, 255, 255, 0.08)"
                      : "1px solid rgba(0, 0, 0, 0.06)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                  }}
                >
                  {m.content}
                </div>

                {m.role === "assistant" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, paddingLeft: 4 }}>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(m.content);
                        showToast("Copied to clipboard", "success");
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        color: themeStyles.textMuted,
                        fontSize: 11,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Copy
                    </button>
                    {typeof window !== "undefined" && "speechSynthesis" in window && (
                      <button
                        onClick={() => {
                          if (isSpeakingReply) {
                            window.speechSynthesis.cancel();
                            setIsSpeakingReply(false);
                          } else {
                            playJarvisVoice(m.content);
                          }
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: isSpeakingReply ? "#EF4444" : "#7C3AED",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        {isSpeakingReply ? "■ Stop" : "▶ Listen"}
                      </button>
                    )}
                    {m.time && <span style={{ fontSize: 10, color: themeStyles.textMuted }}>{m.time}</span>}
                  </div>
                )}
              </div>
            ))}

            {/* Loading Indicator */}
            {aiLoading && (
              <div
                style={{
                  alignSelf: "flex-start",
                  padding: "10px 16px",
                  borderRadius: "18px 18px 18px 4px",
                  background: isDark ? "#242426" : "#F0F0F2",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7C3AED", animation: "pulse 0.9s ease 0s infinite" }} />
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7C3AED", animation: "pulse 0.9s ease 0.2s infinite" }} />
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7C3AED", animation: "pulse 0.9s ease 0.4s infinite" }} />
                <span style={{ fontSize: 12, color: themeStyles.textMuted, marginLeft: 4 }}>Thinking…</span>
              </div>
            )}

            {/* Listening Wave Banner */}
            {aiListening && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "rgba(124, 58, 237, 0.12)",
                  border: "1px solid rgba(124, 58, 237, 0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  animation: "pulse 1.4s ease infinite",
                }}
              >
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#EF4444", boxShadow: "0 0 10px #EF4444" }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: "#7C3AED" }}>
                  Listening… Speak your prompt now
                </div>
              </div>
            )}

            <div ref={aiScrollRef} />
          </div>

          {/* Assistant Input Bar */}
          <div
            style={{
              padding: "12px 14px",
              borderTop: `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"}`,
              background: isDark ? "rgba(255, 255, 255, 0.01)" : "rgba(0, 0, 0, 0.01)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {/* Voice Input Mic Button */}
            <button
              onClick={toggleMicListening}
              title={aiListening ? "Stop Listening" : "Speak to Assistant"}
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: aiListening
                  ? "#EF4444"
                  : isDark
                  ? "rgba(124, 58, 237, 0.2)"
                  : "rgba(124, 58, 237, 0.1)",
                color: aiListening ? "#FFFFFF" : "#7C3AED",
                boxShadow: aiListening ? "0 0 14px rgba(239, 68, 68, 0.5)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              <Icons.Mic size={17} color={aiListening ? "#FFFFFF" : "#7C3AED"} />
            </button>

            {/* Text Input */}
            <input
              style={{
                ...S.input,
                flex: 1,
                fontSize: 13,
                padding: "9px 12px",
                borderRadius: 10,
                border: isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.12)",
              }}
              placeholder="Ask anything about contacts or tap mic…"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendAiQuery();
                }
              }}
            />

            {/* Send Button */}
            <button
              onClick={() => sendAiQuery()}
              disabled={!aiInput.trim() || aiLoading}
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                border: "none",
                cursor: !aiInput.trim() || aiLoading ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "linear-gradient(135deg, #7C3AED, #6366F1)",
                color: "#FFFFFF",
                opacity: !aiInput.trim() || aiLoading ? 0.45 : 1,
                boxShadow: !aiInput.trim() || aiLoading ? "none" : "0 4px 14px rgba(124, 58, 237, 0.3)",
                transition: "all 0.15s ease",
              }}
            >
              <Icons.Send size={15} color="#FFFFFF" />
            </button>
          </div>
        </div>
      )}

      {/* ── TOAST NOTIFICATION ── */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: isMobile ? 80 : 30,
            left: "50%",
            transform: "translateX(-50%)",
            background: toast.type === "success" ? "#10B981" : "#EF4444",
            color: "#ffffff",
            padding: "10px 20px",
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 700,
            zIndex: 600,
            animation: "fadeUp 0.25s ease",
            boxShadow: "0 8px 25px rgba(0,0,0,0.25)",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {toast.type === "success" ? <Icons.Check size={14} color="#fff" /> : <Icons.AlertCircle size={14} color="#fff" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}


// ── ERROR BOUNDARY ────────────────────────────────────────────────────────────
// A render error anywhere used to unmount the whole tree (blank screen that looks
// like the app restarted). Catch it and offer a recovery path instead.
class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("NetworQ crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          background: "#000000",
          color: "#FFFFFF",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Arial, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700 }}>Something went wrong</div>
        <div style={{ fontSize: 14, color: "#AEAEB2", maxWidth: 360 }}>
          Your data is safe. Reload to continue where you left off.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{ minHeight: 44, padding: "10px 22px", borderRadius: 12, border: "none", background: "#7C3AED", color: "#FFFFFF", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
        >
          Reload NetworQ
        </button>
      </div>
    );
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <NetworQApp />
    </AppErrorBoundary>
  );
}
