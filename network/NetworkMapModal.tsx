import React, { useState, useMemo } from "react";
import { haptic } from "../ui/haptics";

interface NetworkMapModalProps {
  open: boolean;
  onClose: () => void;
  currentUser: any;
  contacts: any[];
  isDark: boolean;
  onRequestIntro?: (contact: any) => void;
  onOpenContact?: (contact: any) => void;
}

export function NetworkMapModal({
  open,
  onClose,
  currentUser,
  contacts,
  isDark,
  onRequestIntro,
  onOpenContact,
}: NetworkMapModalProps) {
  const [filterMode, setFilterMode] = useState<"all" | "company" | "event">("all");
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.company || "").toLowerCase().includes(q) ||
        (c.title || "").toLowerCase().includes(q)
    );
  }, [contacts, searchQuery]);

  // Aggregate companies and events for clustering
  const companyClusters = useMemo(() => {
    const map = new Map<string, any[]>();
    filteredContacts.forEach((c) => {
      const comp = c.company || "Independent";
      if (!map.has(comp)) map.set(comp, []);
      map.get(comp)!.push(c);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filteredContacts]);

  if (!open) return null;

  const width = 800;
  const height = 560;
  const cx = width / 2;
  const cy = height / 2;

  // Calculate radial layout for direct connections
  const radius = Math.min(width, height) * 0.38;
  const total = Math.max(1, filteredContacts.length);

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
          maxWidth: 960,
          maxHeight: "min(92dvh, calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px))",
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
            padding: "16px 24px",
            borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
              🕸️ Professional Network Map (Part 11)
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: isDark ? "#94A3B8" : "#64748B" }}>
              Visualizing Me → Direct Connections ({contacts.length}) → Companies & Shared Touchpoints
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="text"
              placeholder="Search network…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: "6px 12px",
                borderRadius: 10,
                border: `1px solid ${isDark ? "rgba(255,255,255,0.15)" : "#CBD5E1"}`,
                background: isDark ? "#1E293B" : "#F8FAFC",
                color: isDark ? "#FFF" : "#000",
                fontSize: 12,
              }}
            />
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: isDark ? "#94A3B8" : "#64748B",
                fontSize: 20,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Graph Canvas */}
        <div style={{ position: "relative", flex: 1, minHeight: 480, overflow: "hidden", background: isDark ? "#0A0D16" : "#F8FAFC" }}>
          <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
            <defs>
              <linearGradient id="networqGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#7C3AED" />
                <stop offset="100%" stopColor="#06B6D4" />
              </linearGradient>
            </defs>

            {/* Orbit rings */}
            <circle cx={cx} cy={cy} r={radius * 0.55} fill="none" stroke={isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"} strokeDasharray="4 4" />
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"} strokeDasharray="6 6" />

            {/* Connection Lines from Me to Contacts */}
            {filteredContacts.map((c, i) => {
              const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
              const x = cx + radius * Math.cos(angle);
              const y = cy + radius * Math.sin(angle);
              const isSelected = selectedNode?.id === c.id;

              return (
                <line
                  key={`line_${c.id}`}
                  x1={cx}
                  y1={cy}
                  x2={x}
                  y2={y}
                  stroke={isSelected ? "#7C3AED" : isDark ? "rgba(124,58,237,0.18)" : "rgba(124,58,237,0.15)"}
                  strokeWidth={isSelected ? 2 : 1}
                />
              );
            })}

            {/* Center "Me" Node */}
            <g transform={`translate(${cx}, ${cy})`}>
              <circle r={28} fill="url(#networqGrad)" filter="drop-shadow(0 0 12px rgba(124,58,237,0.5))" />
              <text textAnchor="middle" dy={5} fill="#FFFFFF" fontSize={13} fontWeight="800">
                Me
              </text>
            </g>

            {/* Contact Nodes */}
            {filteredContacts.map((c, i) => {
              const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
              const x = cx + radius * Math.cos(angle);
              const y = cy + radius * Math.sin(angle);
              const isSelected = selectedNode?.id === c.id;
              const initials = (c.name || "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();

              return (
                <g
                  key={`node_${c.id}`}
                  transform={`translate(${x}, ${y})`}
                  onClick={() => {
                    setSelectedNode(c);
                    haptic();
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    r={isSelected ? 20 : 16}
                    fill={isSelected ? "#7C3AED" : isDark ? "#1E293B" : "#FFFFFF"}
                    stroke={isSelected ? "#C084FC" : isDark ? "rgba(255,255,255,0.2)" : "#CBD5E1"}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                  />
                  <text
                    textAnchor="middle"
                    dy={4}
                    fill={isSelected ? "#FFFFFF" : isDark ? "#E2E8F0" : "#1E293B"}
                    fontSize={10}
                    fontWeight="700"
                  >
                    {initials}
                  </text>
                  <text
                    textAnchor="middle"
                    dy={26}
                    fill={isDark ? "#94A3B8" : "#475569"}
                    fontSize={10}
                    fontWeight="600"
                  >
                    {(c.name || "").split(" ")[0]}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Selected Node Details Card Overlay */}
          {selectedNode && (
            <div
              style={{
                position: "absolute",
                bottom: 16,
                right: 16,
                width: 280,
                padding: 16,
                borderRadius: 16,
                background: isDark ? "rgba(18,24,38,0.92)" : "rgba(255,255,255,0.95)",
                backdropFilter: "blur(10px)",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`,
                boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{selectedNode.name}</h4>
                  <div style={{ fontSize: 12, color: "#7C3AED", fontWeight: 700, marginTop: 2 }}>
                    {[selectedNode.title, selectedNode.company].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer" }}
                >
                  ✕
                </button>
              </div>

              {selectedNode.email && (
                <div style={{ fontSize: 11, color: isDark ? "#94A3B8" : "#64748B", marginTop: 8 }}>
                  ✉️ {selectedNode.email}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                {onRequestIntro && (
                  <button
                    onClick={() => onRequestIntro(selectedNode)}
                    style={{
                      flex: 1,
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "none",
                      background: "#7C3AED",
                      color: "#FFF",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    🤝 Request Intro
                  </button>
                )}
                {onOpenContact && (
                  <button
                    onClick={() => onOpenContact(selectedNode)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.15)" : "#CBD5E1"}`,
                      background: "transparent",
                      color: isDark ? "#FFF" : "#000",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    View
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Clusters summary pill bottom-left */}
          <div
            style={{
              position: "absolute",
              bottom: 16,
              left: 16,
              display: "flex",
              gap: 8,
              alignItems: "center",
              background: isDark ? "rgba(15,20,32,0.85)" : "rgba(255,255,255,0.85)",
              padding: "6px 12px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
              border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
            }}
          >
            <span>🏢 Top Companies:</span>
            {companyClusters.slice(0, 3).map(([comp, list]) => (
              <span key={comp} style={{ color: "#7C3AED" }}>
                {comp} ({list.length})
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
