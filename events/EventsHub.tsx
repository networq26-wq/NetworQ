// Events Hub: real upcoming events imported from their source pages or calendar feeds.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

const PURPLE = "#7C3AED";

export interface PublicEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  venue: string | null;
  city: string | null;
  url: string;
  source_host: string;
  image: string | null;
  description: string | null;
  organizer: string | null;
  verified: boolean;
  category?: string | null;
}

const INDIA_CITIES = new Set(["Hyderabad", "Bengaluru", "Mumbai", "Delhi", "Pune", "Chennai", "Kolkata", "Ahmedabad", "Gurugram", "Noida", "Kochi", "Jaipur"]);
const DATE_FILTERS = ["Any time", "Today", "This weekend", "This week", "This month"] as const;
type DateFilter = (typeof DATE_FILTERS)[number];

// [start, end) for a date filter, in the viewer's local time
function dateRange(f: DateFilter, now = new Date()): [number, number] | null {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (d: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + d).getTime();
  if (f === "Today") return [now.getTime() - 6 * 3600e3, at(1)];
  if (f === "This week") return [now.getTime() - 6 * 3600e3, at(7 - ((day.getDay() + 6) % 7))]; // through Sunday
  if (f === "This weekend") {
    const dow = day.getDay(); // 0 Sun … 6 Sat
    const satOffset = dow === 0 ? -1 : 6 - dow;
    return [Math.max(at(satOffset), now.getTime() - 6 * 3600e3), at(satOffset + 2)];
  }
  if (f === "This month") return [now.getTime() - 6 * 3600e3, new Date(day.getFullYear(), day.getMonth() + 1, 1).getTime()];
  return null;
}

const PREFS_KEY = "networq.events.filters";
function readPrefs(): { city?: string; date?: DateFilter; category?: string } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

type Toast = (message: string, type?: "success" | "error" | "info") => void;

function theme(isDark: boolean) {
  return isDark
    ? { surface: "#1C1C1E", raised: "#2C2C2E", text: "#FFFFFF", muted: "#AEAEB2", border: "rgba(255,255,255,0.08)" }
    : { surface: "#FFFFFF", raised: "#F2F2F7", text: "#1C1C1E", muted: "#6E6E73", border: "rgba(0,0,0,0.08)" };
}

function whenLabel(iso: string) {
  const d = new Date(iso);
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · ${time}`;
}

function icsFor(ev: PublicEvent) {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = ev.ends_at || new Date(new Date(ev.starts_at).getTime() + 2 * 3600 * 1000).toISOString();
  const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NetworQ//Events//EN",
    "BEGIN:VEVENT",
    `UID:${ev.id}@networq`,
    `DTSTAMP:${fmt(new Date().toISOString())}`,
    `DTSTART:${fmt(ev.starts_at)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(ev.title)}`,
    ev.venue ? `LOCATION:${esc(ev.venue)}` : "",
    `URL:${ev.url}`,
    `DESCRIPTION:${esc(`${ev.description || ""}\n${ev.url}`.trim())}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

export function EventsHub({
  supabase,
  apiBaseUrl,
  isDark,
  showToast,
  onAttend,
  onAddContactForEvent,
}: {
  supabase: SupabaseClient;
  apiBaseUrl: string;
  isDark: boolean;
  showToast: Toast;
  onAttend: (ev: PublicEvent) => void;
  onAddContactForEvent: (eventName: string) => void;
}) {
  const t = theme(isDark);
  const [events, setEvents] = useState<PublicEvent[] | null>(null);
  const [query, setQuery] = useState("");
  const saved = useMemo(readPrefs, []);
  const [city, setCity] = useState(saved.city || "All");
  const [dateFilter, setDateFilter] = useState<DateFilter>(saved.date && DATE_FILTERS.includes(saved.date) ? saved.date : "Any time");
  const [category, setCategory] = useState(saved.category || "All");
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ city, date: dateFilter, category }));
    } catch {}
  }, [city, dateFilter, category]);
  const [link, setLink] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data, error } = await supabase.from("public_events").select("*").gte("starts_at", since).order("starts_at", { ascending: true }).limit(800);
    if (error) {
      showToast("Couldn't load events. Pull to retry.", "error");
      setEvents([]);
    } else setEvents((data || []) as PublicEvent[]);
  }, [supabase, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const importLink = async () => {
    if (!link.trim()) return;
    setImporting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(`${apiBaseUrl}/api/events/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` },
        body: JSON.stringify({ url: link.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't import that link.");
      showToast(`Added ${json.events.length} event${json.events.length === 1 ? "" : "s"}.`, "success");
      setLink("");
      await load();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setImporting(false);
    }
  };

  const cities = useMemo(() => {
    const set = new Set<string>();
    (events || []).forEach((e) => set.add(e.venue === "Online" ? "Online" : e.city || ""));
    set.delete("");
    const all = [...set].sort();
    return { india: all.filter((c) => INDIA_CITIES.has(c)), world: all.filter((c) => !INDIA_CITIES.has(c) && c !== "Online"), online: set.has("Online") };
  }, [events]);

  const cityMatch = useCallback(
    (e: PublicEvent) => {
      const c = e.venue === "Online" ? "Online" : e.city || "";
      if (city === "All") return true;
      if (city === "All India") return INDIA_CITIES.has(c);
      if (city === "Worldwide") return !!c && !INDIA_CITIES.has(c) && c !== "Online";
      return c === city;
    },
    [city]
  );

  // Everything except the category filter — used for the category counts
  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    const range = dateRange(dateFilter);
    return (events || []).filter((e) => {
      if (!cityMatch(e)) return false;
      if (range) {
        const t0 = new Date(e.starts_at).getTime();
        if (t0 < range[0] || t0 >= range[1]) return false;
      }
      return !q || [e.title, e.venue, e.organizer, e.city, e.category].some((v) => v?.toLowerCase().includes(q));
    });
  }, [events, query, dateFilter, cityMatch]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    base.forEach((e) => counts.set(e.category || "Business", (counts.get(e.category || "Business") || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [base]);

  const visible = useMemo(() => (category === "All" ? base : base.filter((e) => (e.category || "Business") === category)), [base, category]);
  const filtered = city !== "All" || dateFilter !== "Any time" || category !== "All" || !!query.trim();

  const card: React.CSSProperties = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 20, padding: 20 };
  const input: React.CSSProperties = { minHeight: 44, padding: "10px 14px", borderRadius: 12, border: `1px solid ${t.border}`, background: t.raised, color: t.text, fontSize: 16, boxSizing: "border-box" };
  const chipRow: React.CSSProperties = { display: "flex", gap: 6, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" } as React.CSSProperties;
  const chip = (on: boolean): React.CSSProperties => ({ flexShrink: 0, minHeight: 34, padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", border: `1px solid ${on ? PURPLE : t.border}`, background: on ? PURPLE : t.surface, color: on ? "#FFFFFF" : t.text });
  const btn = (primary = false): React.CSSProperties => ({
    minHeight: 44,
    padding: "10px 14px",
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    border: primary ? "none" : `1px solid ${t.border}`,
    background: primary ? PURPLE : t.raised,
    color: primary ? "#FFFFFF" : t.text,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  });

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16, color: t.text }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 28, letterSpacing: "-0.02em" }}>Events</h2>
        <p style={{ color: t.muted, margin: "4px 0 0", fontSize: 14 }}>Real upcoming events, each linked to its official page.</p>
      </div>

      <section style={card} aria-label="Add an event">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            importLink();
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <input
            style={{ ...input, flex: "1 1 260px" }}
            aria-label="Event or calendar link"
            placeholder="Paste an event link (Luma, Eventbrite, Meetup…) or calendar .ics"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            inputMode="url"
          />
          <button type="submit" style={btn(true)} disabled={importing || !link.trim()}>
            {importing ? "Importing…" : "Add event"}
          </button>
        </form>
        <p style={{ color: t.muted, fontSize: 12, margin: "8px 0 0" }}>
          We read the event's published details (name, date, venue) from its page. Hosting your own? Create it in Radar to get a join code.
        </p>
      </section>

      {events && events.length > 0 && (
        <section aria-label="Filters" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...input, flex: 1, minWidth: 0 }} aria-label="Search events" placeholder="Search events, venues, organisers" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select aria-label="City" value={city} onChange={(e) => setCity(e.target.value)} style={{ ...input, width: "auto", maxWidth: 170, paddingRight: 8, appearance: "auto" as any }}>
              <option value="All">All cities</option>
              <option value="All India">All India</option>
              <option value="Worldwide">Worldwide</option>
              {cities.online && <option value="Online">Online</option>}
              {cities.india.length > 0 && (
                <optgroup label="India">
                  {cities.india.map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              )}
              {cities.world.length > 0 && (
                <optgroup label="Worldwide">
                  {cities.world.map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div role="group" aria-label="Filter by date" className="nq-chips" style={chipRow}>
            {DATE_FILTERS.map((d) => (
              <button key={d} onClick={() => setDateFilter(d)} aria-pressed={dateFilter === d} style={chip(dateFilter === d)}>
                {d}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Filter by category" className="nq-chips" style={chipRow}>
            <button onClick={() => setCategory("All")} aria-pressed={category === "All"} style={chip(category === "All")}>
              All · {base.length}
            </button>
            {categories.map(([c, n]) => (
              <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c} style={chip(category === c)}>
                {c} · {n}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", fontSize: 13, color: t.muted }}>
            <span style={{ flex: 1 }} aria-live="polite">{visible.length} event{visible.length === 1 ? "" : "s"}</span>
            {filtered && (
              <button onClick={() => { setCity("All"); setDateFilter("Any time"); setCategory("All"); setQuery(""); }} style={{ background: "none", border: "none", color: PURPLE, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                Clear filters
              </button>
            )}
          </div>
        </section>
      )}

      {events === null ? (
        <div style={{ ...card, color: t.muted, textAlign: "center" }} aria-busy="true">
          Loading events…
        </div>
      ) : visible.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "36px 20px" }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{events.length ? "No events match your filters" : "No upcoming events yet"}</div>
          <div style={{ color: t.muted, fontSize: 14, maxWidth: 420, margin: "0 auto" }}>
            {events.length ? "Try another date, category or city." : "Paste a link to an event you're going to — everyone on NetworQ will see it, with a link to the official page."}
          </div>
        </div>
      ) : (
        <ul aria-label="Upcoming events" className="nq-stagger" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {visible.map((ev) => (
            <li key={ev.id} style={{ ...card, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {ev.image && <img src={ev.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} style={{ width: "100%", height: 140, objectFit: "cover", display: "block", background: t.raised }} />}
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
                  <span style={{ color: PURPLE, fontWeight: 700 }}>{whenLabel(ev.starts_at)}</span>
                  {ev.category && <span style={{ background: t.raised, color: t.muted, borderRadius: 999, padding: "2px 8px", fontWeight: 600 }}>{ev.category}</span>}
                  {ev.verified && <span style={{ background: "rgba(52,199,89,0.15)", color: "#34C759", borderRadius: 999, padding: "2px 8px", fontWeight: 700 }}>Verified</span>}
                </div>
                <h3 style={{ margin: 0, fontSize: 17, lineHeight: 1.3 }}>{ev.title}</h3>
                {(ev.venue || ev.city) && <div style={{ color: t.muted, fontSize: 13 }}>{[ev.venue, ev.city && !(ev.venue || "").includes(ev.city) ? ev.city : null].filter(Boolean).join(" · ")}</div>}
                {ev.organizer && <div style={{ color: t.muted, fontSize: 13 }}>By {ev.organizer}</div>}
                <div style={{ color: t.muted, fontSize: 12 }}>Source: {ev.source_host}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto", paddingTop: 10 }}>
                  <button style={btn(true)} onClick={() => onAttend(ev)}>
                    I'm attending · Radar
                  </button>
                  <a style={btn()} href={ev.url} target="_blank" rel="noopener noreferrer">
                    Event page ↗
                  </a>
                  <button
                    style={btn()}
                    aria-label={`Add ${ev.title} to calendar`}
                    onClick={() => {
                      const blob = new Blob([icsFor(ev)], { type: "text/calendar" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `${ev.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.ics`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    Add to calendar
                  </button>
                  <button style={btn()} onClick={() => onAddContactForEvent(ev.title)} aria-label={`Add a contact met at ${ev.title}`}>
                    + Contact
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
