export function Wordmark({ className = "", size = 26 }: { className?: string; size?: number }) {
  return (
    <div className={`inline-flex items-center gap-1 font-bold tracking-tight select-none ${className}`}>
      <span className="text-[21px] font-extrabold tracking-[-0.035em] text-foreground">Networ</span>
      <svg
        width={size}
        height={Math.round((size * 551) / 548)}
        viewBox="0 0 548 551"
        fill="none"
        className="inline-block overflow-visible align-middle"
        aria-label="Q"
      >
        <defs>
          <linearGradient id="landingQPurpleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="50%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#1D4ED8" />
          </linearGradient>
          <filter id="landingQGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Left bracket (Capture) */}
        <path
          d="M 115.08 352.76 C 115.08 363.63, 123.89 372.44, 134.76 372.44 L 216 372.44 L 216 487.53 L 107.59 487.53 C 48.17 487.53, 0 439.36, 0 379.94 L 0 107.57 C 0 48.17, 48.17 0, 107.59 0 L 216 0 L 216 115.08 L 134.76 115.08 C 123.89 115.08, 115.08 123.87, 115.08 134.74 Z"
          fill="url(#landingQPurpleGrad)"
        />
        {/* Right bracket with Q tail (Continuity) */}
        <path
          d="M 468.55 467.77 L 548.05 550.87 L 426.92 550.87 L 365.37 487.53 L 298.01 413.36 L 260.86 372.44 L 379.27 372.44 C 390.12 372.44, 398.93 363.63, 398.93 352.76 L 398.93 134.74 C 398.93 123.87, 390.12 115.08, 379.27 115.08 L 298.01 115.08 L 298.01 0 L 406.43 0 C 465.85 0, 514.01 48.17, 514.01 107.57 L 514.01 379.94 C 514.01 416.22, 496.05 448.31, 468.55 467.77 Z"
          fill="url(#landingQPurpleGrad)"
        />
        {/* Center connector bar */}
        <rect
          x="115.08"
          y="202.75"
          width="283.85"
          height="82.01"
          rx="41.01"
          fill="url(#landingQPurpleGrad)"
        />
        {/* Glowing Radar Beacon Node */}
        <circle cx="257" cy="243.75" r="14" fill="#FFFFFF" filter="url(#landingQGlow)" />
      </svg>
    </div>
  );
}
