import React, { useState, useMemo } from "react";
import { I } from "../ui/icons";
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


  return (
    // Full-page search: the bar sits at the very top (not a floating box), results fill the page below
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: isDark ? "#000000" : "#F2F2F7",
        display: "flex",
        justifyContent: "center",
        alignItems: "stretch",
        animation: "fadeIn 0.12s ease",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 760,
          height: "100%",
          color: isDark ? "#F8FAFC" : "#0F172A",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxSizing: "border-box",
          paddingTop: "max(10px, calc(var(--safe-top, env(safe-area-inset-top, 0px)) + 8px))",
          paddingBottom: "var(--safe-bottom, env(safe-area-inset-bottom, 0px))",
        }}
      >
        {/* Search bar — top of the page, full width, with Cancel beside it */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 10px 16px" }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              padding: "0 6px 0 16px",
              minHeight: 52,
              borderRadius: 26,
              background: isDark ? "#1C1C1E" : "#FFFFFF",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <I.Search size={20} style={{ opacity: 0.6, flex: "none" }} />
            <input
              type="search"
              autoFocus
              className="nq-search-input"
              aria-label="Search"
              placeholder="Search people, companies, roles"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose();
              }}
              style={{ flex: 1, minWidth: 0, minHeight: 44, border: "none", outline: "none", background: "transparent", fontSize: 17, color: isDark ? "#FFF" : "#000" }}
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search" style={{ width: 44, height: 44, borderRadius: 22, border: "none", background: "transparent", color: isDark ? "#94A3B8" : "#64748B", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <I.X size={18} />
              </button>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ minHeight: 44, padding: "0 8px", border: "none", background: "transparent", color: "#7C3AED", fontSize: 17, fontWeight: 600, cursor: "pointer", flex: "none" }}>
            Cancel
          </button>
        </div>

        {/* Filter Pills */}
        <div
          style={{
            padding: "2px 16px 10px",
            display: "flex",
            gap: 8,
            overflowX: "auto",
            scrollbarWidth: "none",
          }}
        >
          {(["all", "skills", "company", "location"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              style={{
                minHeight: 44,
                padding: "0 16px",
                borderRadius: 22,
                flex: "none",
                border: `1px solid ${filterType === t ? "transparent" : isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
                background: filterType === t ? (isDark ? "#FFFFFF" : "#1C1C1E") : isDark ? "#1C1C1E" : "#FFFFFF",
                color: filterType === t ? (isDark ? "#000" : "#FFF") : isDark ? "#E5E5EA" : "#1C1C1E",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Results List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px 24px" }}>
          {query.trim().length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 16px", color: isDark ? "#AEAEB2" : "#6E6E73", fontSize: 16, lineHeight: 1.45 }}>
              Search your contacts by name, company, role or tag.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Local Contacts Section */}
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: isDark ? "#C4B5FD" : "#6D28D9", marginBottom: 8, display: "flex", alignItems: "center" }}>
                  <I.Contact size={15} style={{ marginRight: 6 }} />My Contacts ({localMatches.length})
                </div>
                {localMatches.length === 0 ? (
                  <div style={{ fontSize: 15, color: isDark ? "#AEAEB2" : "#6E6E73" }}>
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
                          padding: "12px 16px",
                          minHeight: 60,
                          boxSizing: "border-box",
                          borderRadius: 16,
                          background: isDark ? "#1C1C1E" : "#FFFFFF",
                          border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 17, fontWeight: 600 }}>{c.name}</div>
                          <div style={{ fontSize: 15, color: isDark ? "#AEAEB2" : "#6E6E73" }}>
                            {[c.title, c.company].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <span style={{ fontSize: 15, color: isDark ? "#C4B5FD" : "#6D28D9", fontWeight: 600 }}>Open</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
