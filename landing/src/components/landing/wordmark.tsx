import React from "react";
import networqLogo from "../../assets/networq-logo.png";
import networqLogoDark from "../../assets/networq-logo-dark.png";

export function NetworQLogo({
  size = 28,
  scanning = true,
  className = "",
  style,
}: {
  size?: number;
  scanning?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={Math.round((size * 551) / 548)}
      viewBox="0 0 548 551"
      fill="none"
      className={className}
      style={{ overflow: "visible", display: "inline-block", verticalAlign: "middle", ...style }}
      aria-label="NetworQ Logo"
    >
      <defs>
        {/* Signature NetworQ Royal Violet Gradient */}
        <linearGradient id="qVioletGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="40%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>

        <linearGradient id="qLaserGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(192, 132, 252, 0)" />
          <stop offset="25%" stopColor="#C084FC" />
          <stop offset="50%" stopColor="#FFFFFF" />
          <stop offset="75%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="rgba(167, 139, 250, 0)" />
        </linearGradient>

        <linearGradient id="qBeamWash" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(168, 85, 247, 0)" />
          <stop offset="60%" stopColor="rgba(139, 92, 246, 0.25)" />
          <stop offset="100%" stopColor="rgba(109, 40, 217, 0.4)" />
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

      {/* Left bracket (Capture) in Signature Violet */}
      <path
        d="M 115.08 352.76 C 115.08 363.63, 123.89 372.44, 134.76 372.44 L 216 372.44 L 216 487.53 L 107.59 487.53 C 48.17 487.53, 0 439.36, 0 379.94 L 0 107.57 C 0 48.17, 48.17 0, 107.59 0 L 216 0 L 216 115.08 L 134.76 115.08 C 123.89 115.08, 115.08 123.87, 115.08 134.74 Z"
        fill="url(#qVioletGrad)"
      />
      {/* Right bracket with Q tail (Continuity) in Signature Violet */}
      <path
        d="M 468.55 467.77 L 548.05 550.87 L 426.92 550.87 L 365.37 487.53 L 298.01 413.36 L 260.86 372.44 L 379.27 372.44 C 390.12 372.44, 398.93 363.63, 398.93 352.76 L 398.93 134.74 C 398.93 123.87, 390.12 115.08, 379.27 115.08 L 298.01 115.08 L 298.01 0 L 406.43 0 C 465.85 0, 514.01 48.17, 514.01 107.57 L 514.01 379.94 C 514.01 416.22, 496.05 448.31, 468.55 467.77 Z"
        fill="url(#qVioletGrad)"
      />
      {/* Center connector bar in Signature Violet */}
      <rect
        x="115.08"
        y="202.75"
        width="283.85"
        height="82.01"
        fill="url(#qVioletGrad)"
      />

      {/* Live radar scanner laser beam */}
      {scanning && (
        <g clipPath="url(#qInnerCavityClip)">
          <rect x="110" y="115" width="290" height="34" fill="url(#qBeamWash)">
            <animate attributeName="y" values="115;338;115" dur="2.2s" repeatCount="indefinite" />
          </rect>
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
          <circle cx="257" cy="159" r="6" fill="#C084FC" opacity="0.6">
            <animate attributeName="r" values="3;34;3" dur="2.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;0;0.8" dur="2.2s" repeatCount="indefinite" />
          </circle>
          <circle cx="247" cy="328" r="6" fill="#8B5CF6" opacity="0.6">
            <animate attributeName="r" values="3;30;3" dur="2.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0;0.7" dur="2.2s" repeatCount="indefinite" />
          </circle>
        </g>
      )}
    </svg>
  );
}

// The beam that scans inside the Q's opening — drawn over the official logo image, in the logo's own violets.
const QSCAN_CSS = `
.nq-qscan{position:absolute;left:84.4%;width:9.9%;top:21.9%;height:44.6%;overflow:hidden;pointer-events:none;border-radius:2px}
.nq-qscan>i{position:absolute;inset:0;animation:nqQScan 2.4s cubic-bezier(.45,0,.55,1) infinite}
.nq-qscan>i::before{content:"";position:absolute;left:0;right:0;bottom:100%;height:60%;background:linear-gradient(180deg,rgba(113,93,252,0),rgba(113,93,252,.28))}
.nq-qscan>i::after{content:"";position:absolute;left:-10%;right:-10%;top:0;height:max(1.5px,8%);border-radius:2px;background:linear-gradient(90deg,rgba(94,53,245,0),#715DFC 25%,#E9E4FF 50%,#715DFC 75%,rgba(94,53,245,0));box-shadow:0 0 6px 1px rgba(94,53,245,.55)}
@keyframes nqQScan{0%{transform:translateY(0)}50%{transform:translateY(100%)}100%{transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.nq-qscan{display:none}}
`;

function LogoImage({ src, size, scanning, className = "", style }: { src: string; size: number; scanning: boolean; className?: string; style?: React.CSSProperties | undefined }) {
  return (
    <span className={`relative select-none ${className}`} style={{ lineHeight: 0, ...style }}>
      <img src={src} alt="NetworQ" style={{ height: size, width: "auto", display: "block" }} className="object-contain" draggable={false} />
      {scanning && (
        <span className="nq-qscan" aria-hidden>
          <i />
        </span>
      )}
    </span>
  );
}

export function Wordmark({
  className = "",
  size = 28,
  scanning = true,
  theme = "auto",
  style,
}: {
  className?: string;
  size?: number;
  scanning?: boolean;
  theme?: "auto" | "light" | "dark";
  style?: React.CSSProperties;
}) {
  return (
    <>
      <style>{QSCAN_CSS}</style>
      {theme === "light" ? (
        <LogoImage src={networqLogo} size={size} scanning={scanning} className={`inline-block ${className}`} style={style} />
      ) : theme === "dark" ? (
        <LogoImage src={networqLogoDark} size={size} scanning={scanning} className={`inline-block ${className}`} style={style} />
      ) : (
        <span className={`inline-flex items-center select-none ${className}`} style={style}>
          <LogoImage src={networqLogo} size={size} scanning={scanning} className="inline-block dark:hidden" />
          <LogoImage src={networqLogoDark} size={size} scanning={scanning} className="hidden dark:inline-block" />
        </span>
      )}
    </>
  );
}
