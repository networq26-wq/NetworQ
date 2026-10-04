import React, { useState, useMemo } from "react";
import { haptic } from "../ui/haptics";

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  contacts: any[];
  isDark: boolean;
  onSelectContact: (contact: any) => void;
  onRequestConnect?: (profile: any) => void;
  supabase: any;
}

export function GlobalSearchModal({
  open,
  onClose,
  contacts,
  isDark,
  onSelectContact,
  onRequestConnect,
  supabase,
}: GlobalSearchModalProps) {
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "skills" | "company" | "location">("all");
  const [remoteResults, setRemoteResults] = useState<any[]>([]);
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);

  // Local contacts matches
  const localMatches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return contacts.filter((c) => {
      const matchName = (c.name || "").toLowerCase().includes(q);
      const matchCompany = (c.company || "").toLowerCase().includes(q);
      const matchTitle = (c.title || "").toLowerCase().includes(q);
      const matchTags = (c.tags || []).some((t: string) => t.toLowerCase().includes(q));
      const matchNotes = (c.notes || "").toLowerCase().includes(q);
      const matchLocation = (c.address || c.location || "").toLowerCase().includes(q);

      if (filterType === "company") return matchCompany;
      if (filterType === "location") return matchLocation;
      if (filterType === "skills") return matchTags || matchTitle;
      return matchName || matchCompany || matchTitle || matchTags || matchNotes || matchLocation;
    });
  }, [contacts, query, filterType]);

  if (!open) return null;

  const handleRemoteSearch = async () => {
    if (!query.trim() || query.length < 2) return;
    setIsSearchingRemote(true);
    try {
      // Query discoverable profiles through Supabase respecting RLS and privacy flags
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, company, role, avatar_url, location, skills")
        .or(`name.ilike.%${query}%,company.ilike.%${query}%,role.ilike.%${query}%`)
        .limit(10);

      if (!error && data) {
        setRemoteResults(data);
      }
    } catch {
      // Graceful fallback
    } finally {
      setIsSearchingRemote(false);
    }
  };

  return (
    <div
      className="nq-backdrop"
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
        className="nq-pop"
        style={{
          width: "100%",
          maxWidth: 680,
          maxHeight: "min(88dvh, calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px))",
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
        {/* Search Input Bar */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 18 }}>🔍</span>
          <input
            type="text"
            autoFocus
            placeholder="Search by name, company, job title, skills, or location…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRemoteSearch();
            }}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 16,
              color: isDark ? "#FFF" : "#000",
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

        {/* Filter Pills */}
        <div
          style={{
            padding: "10px 24px",
            display: "flex",
            gap: 8,
            borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"}`,
          }}
        >
          {(["all", "skills", "company", "location"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              style={{
                padding: "6px 12px",
                borderRadius: 20,
                border: "none",
                background: filterType === t ? "#7C3AED" : isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9",
                color: filterType === t ? "#FFF" : isDark ? "#94A3B8" : "#64748B",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Results List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          {query.trim().length === 0 ? (
            <div style={{ textAlign: "center", padding: 48, color: isDark ? "#64748B" : "#94A3B8", fontSize: 14 }}>
              Type a keyword to search your contacts or discover verified professionals.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Local Contacts Section */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#7C3AED", textTransform: "uppercase", marginBottom: 8 }}>
                  📇 My Contacts ({localMatches.length})
                </div>
                {localMatches.length === 0 ? (
                  <div style={{ fontSize: 13, color: isDark ? "#64748B" : "#94A3B8", fontStyle: "italic" }}>
                    No contacts found matching "{query}"
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {localMatches.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => {
                          onSelectContact(c);
                          onClose();
                          haptic();
                        }}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 14,
                          background: isDark ? "rgba(255,255,255,0.03)" : "#F8FAFC",
                          border: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "#E2E8F0"}`,
                          cursor: "pointer",
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
                        <span style={{ fontSize: 12, color: "#7C3AED", fontWeight: 700 }}>View ↗</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Discoverable Network Section */}
              {remoteResults.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#06B6D4", textTransform: "uppercase", marginBottom: 8 }}>
                    🌐 Discoverable Professionals
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {remoteResults.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 14,
                          background: isDark ? "rgba(255,255,255,0.03)" : "#F8FAFC",
                          border: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "#E2E8F0"}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: isDark ? "#94A3B8" : "#64748B" }}>
                            {[p.role, p.company].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        {onRequestConnect && (
                          <button
                            onClick={() => {
                              onRequestConnect(p);
                              haptic();
                            }}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 8,
                              border: "none",
                              background: "#06B6D4",
                              color: "#FFF",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            + Connect
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
