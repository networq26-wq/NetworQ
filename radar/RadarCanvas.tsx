// Live sonar view. Rings encode approximate distance only — BLE gives no direction,
// so each person keeps a stable angle derived from their id.
import React, { useEffect, useRef } from "react";
import { BUCKET_LABEL, type DistanceBucket } from "./proximity";
import type { RadarPerson } from "./useEventRadar";

// Inner ring keeps clear of the YOU marker (avatar 16px + marker 12px)
const RING_FOR_BUCKET: Record<DistanceBucket, number> = {
  very_close: 0.23,
  "3m": 0.35,
  "5m": 0.47,
  "10m": 0.64,
  "20m": 0.8,
  far: 0.92,
};
const UNKNOWN_RING = 0.92;
const RINGS: { r: number; label: string }[] = [
  { r: 0.47, label: "5 m" },
  { r: 0.64, label: "10 m" },
  { r: 0.8, label: "20 m" },
];

function hashAngle(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
}

const MIN_GAP_PX = 46; // avatar + label clearance

interface Blip {
  homeAngle: number; // stable per person
  angle: number; // home angle plus separation offset
  r: number; // current (animated) radius fraction
  alpha: number;
  lastPing: number;
}

export function RadarCanvas({
  people,
  isDark,
  onSelect,
  scanning,
}: {
  people: RadarPerson[];
  isDark: boolean;
  onSelect: (userId: string) => void;
  scanning: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const blips = useRef(new Map<string, Blip>());
  const peopleRef = useRef(people);
  const images = useRef(new Map<string, HTMLImageElement>());
  peopleRef.current = people;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let size = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      size = Math.min(wrap.clientWidth, 520);
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const start = performance.now();

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const c = size / 2;
      const R = size / 2 - 6;
      ctx.clearRect(0, 0, size, size);

      // Field
      const bg = ctx.createRadialGradient(c, c, 0, c, c, R);
      bg.addColorStop(0, isDark ? "rgba(124,58,237,0.22)" : "rgba(124,58,237,0.12)");
      bg.addColorStop(1, isDark ? "rgba(10,10,14,0.95)" : "rgba(255,255,255,0.95)");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.fill();

      // Rings
      ctx.font = "600 10px -apple-system, BlinkMacSystemFont, 'SF Pro Text', Arial";
      ctx.textAlign = "left";
      for (const ring of RINGS) {
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.08)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(c, c, R * ring.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)";
        ctx.fillText(ring.label, c + 4, c - R * ring.r + 12);
      }

      // Sweep
      const sweep = reduceMotion || !scanning ? -Math.PI / 2 : (t * 1.1) % (Math.PI * 2);
      if (scanning && !reduceMotion) {
        const grad = ctx.createConicGradient?.(sweep - 0.9, c, c);
        if (grad) {
          grad.addColorStop(0, "rgba(124,58,237,0)");
          grad.addColorStop(0.14, "rgba(124,58,237,0.28)");
          grad.addColorStop(0.145, "rgba(124,58,237,0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(c, c);
          ctx.arc(c, c, R, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Separate overlapping avatars by nudging angles apart (radius = distance stays honest)
      const list = [...blips.current.values()];
      for (let iter = 0; iter < 3; iter++) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i];
            const b2 = list[j];
            const ax = Math.cos(a.angle) * R * a.r, ay = Math.sin(a.angle) * R * a.r;
            const bx = Math.cos(b2.angle) * R * b2.r, by = Math.sin(b2.angle) * R * b2.r;
            const d = Math.hypot(ax - bx, ay - by);
            if (d >= MIN_GAP_PX) continue;
            const push = ((MIN_GAP_PX - d) / (R * Math.max(0.2, (a.r + b2.r) / 2))) * 0.25;
            let diff = Math.atan2(Math.sin(b2.angle - a.angle), Math.cos(b2.angle - a.angle));
            if (diff === 0) diff = 0.001;
            a.angle -= Math.sign(diff) * push;
            b2.angle += Math.sign(diff) * push;
          }
        }
      }
      // Ease back toward home angles when space allows
      for (const b of list) {
        const back = Math.atan2(Math.sin(b.homeAngle - b.angle), Math.cos(b.homeAngle - b.angle));
        b.angle += back * 0.01;
      }

      // People
      const live = new Set<string>();
      for (const p of peopleRef.current) {
        live.add(p.userId);
        const target = p.bucket ? RING_FOR_BUCKET[p.bucket] : UNKNOWN_RING;
        let b = blips.current.get(p.userId);
        if (!b) {
          const home = hashAngle(p.userId);
          b = { homeAngle: home, angle: home, r: target, alpha: 0, lastPing: 0 };
          blips.current.set(p.userId, b);
        }
        b.r += (target - b.r) * 0.08; // glide between rings
        b.alpha += ((p.faded ? 0.35 : 1) - b.alpha) * 0.1;

        const x = c + Math.cos(b.angle) * R * b.r;
        const y = c + Math.sin(b.angle) * R * b.r;
        const diff = Math.abs(((sweep - b.angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
        if (diff < 0.08) b.lastPing = now;
        const ping = Math.max(0, 1 - (now - b.lastPing) / 900);

        ctx.globalAlpha = b.alpha;
        if (ping > 0) {
          ctx.strokeStyle = `rgba(124,58,237,${0.6 * ping})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 18 + (1 - ping) * 14, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Avatar: photo if provided, otherwise neutral silhouette (design system)
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, Math.PI * 2);
        ctx.fillStyle = "#3A3A3C";
        ctx.fill();
        ctx.clip();
        const img = p.avatar ? images.current.get(p.avatar) : undefined;
        if (p.avatar && !img) {
          const im = new Image();
          im.src = p.avatar;
          images.current.set(p.avatar, im);
        }
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, x - 16, y - 16, 32, 32);
        } else {
          ctx.fillStyle = "#AEAEB2";
          ctx.beginPath();
          ctx.arc(x, y - 4, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x, y + 12, 10, Math.PI, 0);
          ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = "#7C3AED";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, Math.PI * 2);
        ctx.stroke();

        ctx.textAlign = "center";
        ctx.fillStyle = isDark ? "#FFFFFF" : "#1C1C1E";
        ctx.font = "600 11px -apple-system, BlinkMacSystemFont, 'SF Pro Text', Arial";
        ctx.fillText(p.name.split(" ")[0], x, y + 30);
        ctx.fillStyle = isDark ? "#AEAEB2" : "#6E6E73";
        ctx.font = "500 10px -apple-system, BlinkMacSystemFont, 'SF Pro Text', Arial";
        ctx.fillText(p.bucket ? BUCKET_LABEL[p.bucket] : "Nearby", x, y + 42);
        ctx.globalAlpha = 1;
      }
      for (const id of [...blips.current.keys()]) if (!live.has(id)) blips.current.delete(id);

      // You
      const pulse = reduceMotion ? 0 : (t % 2) / 2;
      ctx.strokeStyle = `rgba(124,58,237,${0.5 * (1 - pulse)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c, c, 14 + pulse * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#7C3AED";
      ctx.beginPath();
      ctx.arc(c, c, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "700 9px -apple-system, BlinkMacSystemFont, 'SF Pro Text', Arial";
      ctx.textAlign = "center";
      ctx.fillText("YOU", c, c + 3);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [isDark, scanning]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const size = rect.width;
    const c = size / 2;
    const R = size / 2 - 6;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let best: { id: string; d: number } | null = null;
    for (const [id, b] of blips.current) {
      const x = c + Math.cos(b.angle) * R * b.r;
      const y = c + Math.sin(b.angle) * R * b.r;
      const d = Math.hypot(px - x, py - y);
      if (d < 26 && (!best || d < best.d)) best = { id, d };
    }
    if (best) onSelect(best.id);
  };

  return (
    <div ref={wrapRef} style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        role="img"
        aria-label={`Radar showing ${people.length} nearby attendee${people.length === 1 ? "" : "s"}`}
        style={{ cursor: people.length ? "pointer" : "default", touchAction: "manipulation" }}
      />
    </div>
  );
}
