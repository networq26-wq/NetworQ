// Events Hub: real upcoming events imported from their source pages or calendar feeds.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { I, Skeleton } from "../ui/icons";
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
const DATE_FILTERS = ["Any time", "Today", "This weekend", "This week", "This month", "Pick"] as const;
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

// Date-only events are stored at midnight UTC — show them as "All day", not a fake early-morning time
export const isAllDay = (iso: string) => /T00:00:00(\.0+)?(Z|\+00:00)$/.test(iso);

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
    ...(isAllDay(ev.starts_at)
      ? [`DTSTART;VALUE=DATE:${ev.starts_at.slice(0, 10).replace(/-/g, "")}`, `DTEND;VALUE=DATE:${new Date(new Date(ev.starts_at).getTime() + 86400000).toISOString().slice(0, 10).replace(/-/g, "")}`]
      : [`DTSTART:${fmt(ev.starts_at)}`, `DTEND:${fmt(end)}`]),
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
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const saved = useMemo(readPrefs, []);
  const [city, setCity] = useState(saved.city || "All");
  const [dateFilter, setDateFilter] = useState<DateFilter>(saved.date && DATE_FILTERS.includes(saved.date) && saved.date !== "Pick" ? saved.date : "Any time");
  const [category, setCategory] = useState(saved.category || "All");
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ city, date: dateFilter, category }));
    } catch {}
  }, [city, dateFilter, category]);
  const [link, setLink] = useState("");
  const [importing, setImporting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data, error } = await supabase.from("public_events").select("*").gte("starts_at", since).order("starts_at", { ascending: true }).limit(800);
    if (error) {
      setLoadError(true);
      setEvents([]);
    } else {
      setLoadError(false);
      setEvents((data || []) as PublicEvent[]);
    }
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
      setAddOpen(false);
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
    const range =
      dateFilter === "Pick" && pickedDay
        ? ([new Date(pickedDay + "T00:00:00").getTime(), new Date(pickedDay + "T00:00:00").getTime() + 86400000] as [number, number])
        : dateRange(dateFilter);
    return (events || []).filter((e) => {
      if (!cityMatch(e)) return false;
      if (range) {
        const t0 = new Date(e.starts_at).getTime();
        if (t0 < range[0] || t0 >= range[1]) return false;
      }
      return !q || [e.title, e.venue, e.organizer, e.city, e.category].some((v) => v?.toLowerCase().includes(q));
    });
  }, [events, query, dateFilter, pickedDay, cityMatch]);

  // Counts for the location sheet and dots for the calendar
  const cityCount = useCallback(
    (v: string) =>
      (events || []).filter((e) => {
        const c = e.venue === "Online" ? "Online" : e.city || "";
        if (v === "All") return true;
        if (v === "All India") return INDIA_CITIES.has(c);
        if (v === "Worldwide") return !!c && !INDIA_CITIES.has(c) && c !== "Online";
        return c === v;
      }).length,
    [events]
  );
  const busyDays = useMemo(() => {
    const set = new Set<string>();
    (events || []).forEach((e) => {
      if (!cityMatch(e)) return;
      const d = new Date(e.starts_at);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    });
    return set;
  }, [events, cityMatch]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    base.forEach((e) => counts.set(e.category || "Business", (counts.get(e.category || "Business") || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [base]);

  const visible = useMemo(() => (category === "All" ? base : base.filter((e) => (e.category || "Business") === category)), [base, category]);
  const filtered = city !== "All" || dateFilter !== "Any time" || category !== "All" || !!query.trim();

  const card: React.CSSProperties = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 20, padding: 20 };
  const input: React.CSSProperties = { minHeight: 44, padding: "10px 14px", borderRadius: 12, border: `1px solid ${t.border}`, background: t.raised, color: t.text, fontSize: 16, boxSizing: "border-box" };
  const btn = (primary = false): React.CSSProperties => ({ minHeight: 44, padding: "10px 16px", borderRadius: 14, fontSize: 15, fontWeight: 600, cursor: "pointer", border: "none", background: primary ? PURPLE : t.raised, color: primary ? "#FFFFFF" : t.text, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 });
  const cityLabel = city === "All" ? "All cities" : city;
  const dateLabel = dateFilter === "Pick" && pickedDay ? new Date(pickedDay + "T00:00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) : dateFilter === "Any time" ? "" : dateFilter;

  // Results grouped by day: "Today", "Tomorrow", "Sat, 10 Oct"
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: PublicEvent[] }[] = [];
    visible.forEach((ev) => {
      const d = new Date(ev.starts_at);
      const key = d.toDateString();
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        const days = Math.round((new Date(key).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
        const label = days < 0 ? "Started recently" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
        g = { key, label, items: [] };
        out.push(g);
      }
      g.items.push(ev);
    });
    return out;
  }, [visible]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, color: t.text }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>Events</h2>
          <p style={{ color: t.muted, margin: "4px 0 0", fontSize: 15 }}>Real events near you, each linked to its official page.</p>
        </div>
        <button onClick={() => setAddOpen(true)} aria-label="Add an event" className="btn-press" style={{ ...btn(true), minHeight: 40, padding: "0 16px", borderRadius: 20, flexShrink: 0 }}>
          <span aria-hidden style={{ fontSize: 20, lineHeight: 1, marginTop: -2 }}>+</span> Add
        </button>
      </header>

      {events && events.length > 0 && <HeroCarousel events={events} cityMatch={cityMatch} isDark={isDark} onAttend={onAttend} />}

      {events && events.length > 0 && (
        <section aria-label="Filters" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Search with the location built in */}
          <div style={{ display: "flex", alignItems: "center", gap: 0, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: "4px 4px 4px 14px", minHeight: 52, boxSizing: "border-box" }}>
            <span aria-hidden style={{ color: t.muted, display: "flex" }}><I.Search size={18} /></span>
            <input aria-label="Search events" placeholder="Search events" className="nq-search-input" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: t.text, fontSize: 16, padding: "0 10px", fontFamily: "inherit", minHeight: 44 }} />
            <button onClick={() => setCityOpen(true)} aria-label={`Location: ${cityLabel}`} style={{ flexShrink: 0, minHeight: 44, maxWidth: 170, padding: "0 12px", borderRadius: 12, border: "none", background: t.raised, color: t.text, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <I.MapPin size={16} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cityLabel}</span>
              <span aria-hidden style={{ fontSize: 10, opacity: 0.6 }}>▼</span>
            </button>
          </div>

          {/* When: one calm segmented control + a calendar for any exact day */}
          <div style={{ display: "flex", gap: 8 }}>
            <div role="group" aria-label="Filter by date" style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", background: t.raised, borderRadius: 14, padding: 3, gap: 2 }}>
              {(["Any time", "Today", "This weekend", "This week"] as const).map((d) => {
                const on = dateFilter === d;
                return (
                  <button key={d} onClick={() => setDateFilter(d)} aria-pressed={on} style={{ minHeight: 40, borderRadius: 11, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", background: on ? t.surface : "transparent", color: on ? t.text : t.muted, boxShadow: on ? "0 1px 3px rgba(0,0,0,0.12)" : "none", transition: "background 0.15s ease, color 0.15s ease" }}>
                    {d === "Any time" ? "All" : d === "This weekend" ? "Weekend" : d}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setCalOpen(true)} aria-label={dateFilter === "Pick" ? `Date: ${dateLabel}` : "Pick a date"} aria-pressed={dateFilter === "Pick"} style={{ flexShrink: 0, minWidth: 46, minHeight: 46, padding: dateFilter === "Pick" ? "0 12px" : 0, borderRadius: 14, border: "none", cursor: "pointer", background: dateFilter === "Pick" ? PURPLE : t.raised, color: dateFilter === "Pick" ? "#FFFFFF" : t.text, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
              <I.Calendar size={18} />
              {dateFilter === "Pick" && dateLabel}
            </button>
          </div>

          {/* What */}
          <div role="group" aria-label="Filter by category" className="nq-chips" style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", margin: "0 -16px", padding: "0 16px" } as React.CSSProperties}>
            {[["All", base.length] as const, ...categories].map(([c, n]) => {
              const on = category === c;
              return (
                <button key={c} onClick={() => setCategory(c)} aria-pressed={on} style={{ flexShrink: 0, minHeight: 34, padding: "0 12px", borderRadius: 17, fontSize: 13, fontWeight: on ? 600 : 500, cursor: "pointer", whiteSpace: "nowrap", border: "none", background: on ? (isDark ? "#FFFFFF" : "#1C1C1E") : t.surface, color: on ? (isDark ? "#1C1C1E" : "#FFFFFF") : t.text, boxShadow: on ? "none" : `inset 0 0 0 1px ${t.border}` }}>
                  {c} · {n}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", fontSize: 14, color: t.muted, padding: "0 2px" }}>
            <span style={{ flex: 1 }} aria-live="polite">
              {visible.length} event{visible.length === 1 ? "" : "s"}
              {city !== "All" ? ` · ${cityLabel}` : ""}
              {dateLabel ? ` · ${dateLabel}` : ""}
            </span>
            {filtered && (
              <button onClick={() => { setCity("All"); setDateFilter("Any time"); setPickedDay(null); setCategory("All"); setQuery(""); }} style={{ background: "none", border: "none", color: PURPLE, fontWeight: 600, fontSize: 14, cursor: "pointer", minHeight: 32 }}>
                Clear filters
              </button>
            )}
          </div>
        </section>
      )}

      {events === null ? (
        <ul role="status" aria-label="Loading events" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton h={0} r={22} style={{ aspectRatio: "1.586", height: "auto" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Skeleton w="100%" h={44} r={14} />
              </div>
            </li>
          ))}
        </ul>
      ) : loadError ? (
        <div role="alert" className="nq-pop" style={{ ...card, textAlign: "center", padding: "32px 20px" }}>
          <div style={{ width: 52, height: 52, borderRadius: 26, margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", background: t.raised, color: t.muted }}>
            <I.Alert size={24} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Couldn't load events</div>
          <div style={{ color: t.muted, fontSize: 14, marginBottom: 16 }}>Check your connection and try again.</div>
          <button style={btn(true)} onClick={() => { setEvents(null); load(); }}>Try again</button>
        </div>
      ) : visible.length === 0 ? (
        <div className="nq-pop" style={{ ...card, textAlign: "center", padding: "36px 20px" }}>
          <div style={{ width: 52, height: 52, borderRadius: 26, margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", background: t.raised, color: PURPLE }}>
            {events.length ? <I.Search size={24} /> : <I.Calendar size={24} />}
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{events.length ? "No events match your filters" : "No upcoming events yet"}</div>
          <div style={{ color: t.muted, fontSize: 14, maxWidth: 420, margin: "0 auto 16px" }}>
            {events.length ? "Try another date, category or city." : "Add an event you're going to — everyone on NetworQ will see it, with a link to the official page."}
          </div>
          {!events.length && <button style={btn(true)} onClick={() => setAddOpen(true)}>Add an event</button>}
        </div>
      ) : (
        <div aria-label="Upcoming events" role="list" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {groups.map((g) => (
            <section key={g.key} role="presentation">
              <h3 style={{ position: "sticky", top: 0, zIndex: 1, margin: "0 0 10px", padding: "6px 2px", fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", background: isDark ? "rgba(0,0,0,0.82)" : "rgba(245,245,247,0.86)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderRadius: 10 }}>{g.label}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 18 }}>
                {g.items.map((ev) => (
                  <EventCard key={ev.id} ev={ev} t={t} isDark={isDark} onAttend={onAttend} onAddContact={onAddContactForEvent} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {addOpen && (
        <Sheet title="Add an event" t={t} onClose={() => setAddOpen(false)}>
          <p style={{ color: t.muted, fontSize: 15, margin: "0 0 14px", lineHeight: 1.45 }}>Paste a link from Luma, Eventbrite, Meetup or a calendar (.ics). We read the published name, date and venue from the page.</p>
          <form onSubmit={(e) => { e.preventDefault(); importLink(); }} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input style={{ ...input, width: "100%", minHeight: 50 }} aria-label="Event or calendar link" placeholder="https://lu.ma/…" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" autoFocus />
            <button type="submit" style={{ ...btn(true), minHeight: 52, fontSize: 17, opacity: importing || !link.trim() ? 0.5 : 1 }} disabled={importing || !link.trim()}>
              {importing ? "Adding…" : "Add event"}
            </button>
          </form>
          <p style={{ color: t.muted, fontSize: 13, margin: "12px 0 0" }}>Hosting your own? Create it in Radar to get a join code.</p>
        </Sheet>
      )}

      {cityOpen && (
        <Sheet title="Location" t={t} onClose={() => setCityOpen(false)}>
          <div role="radiogroup" aria-label="City" style={{ display: "flex", flexDirection: "column" }}>
            {[
              { v: "All", label: "All cities" },
              { v: "All India", label: "All India" },
              ...(cities.online ? [{ v: "Online", label: "Online" }] : []),
              ...cities.india.map((c) => ({ v: c, label: c })),
              { v: "Worldwide", label: "Worldwide" },
              ...cities.world.map((c) => ({ v: c, label: c })),
            ].map((o, i) => {
              const on = city === o.v;
              const n = cityCount(o.v);
              return (
                <button key={o.v} role="radio" aria-checked={on} onClick={() => { setCity(o.v); setCityOpen(false); }} style={{ all: "unset", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "0 4px", borderTop: i ? `1px solid ${t.border}` : "none", cursor: "pointer", color: t.text }}>
                  <span style={{ flex: 1, fontSize: 16, fontWeight: on ? 600 : 400 }}>{o.label}</span>
                  <span style={{ color: t.muted, fontSize: 14 }}>{n}</span>
                  <span aria-hidden style={{ width: 22, color: PURPLE, display: "flex", justifyContent: "flex-end" }}>{on && <I.Check size={20} strokeWidth={2.4} />}</span>
                </button>
              );
            })}
          </div>
        </Sheet>
      )}

      {calOpen && (
        <Sheet title="Pick a date" t={t} onClose={() => setCalOpen(false)}>
          <MonthPicker
            t={t}
            isDark={isDark}
            selected={dateFilter === "Pick" ? pickedDay : null}
            busyDays={busyDays}
            onPick={(day) => { setPickedDay(day); setDateFilter("Pick"); setCalOpen(false); }}
          />
        </Sheet>
      )}
    </div>
  );
}

// A premium, card-shaped event: the picture fills it, everything important is readable at a glance,
// one clear action ("Going") with quieter extras beside it.
const CATEGORY_TINT: Record<string, [string, string]> = {
  "AI & Data": ["#4F46E5", "#7C3AED"],
  "Finance & Web3": ["#0F766E", "#2563EB"],
  Networking: ["#7C3AED", "#DB2777"],
  "Conferences & Expos": ["#1E3A8A", "#7C3AED"],
  Startups: ["#EA580C", "#DB2777"],
  Design: ["#DB2777", "#9333EA"],
};
function EventCard({ ev, t, isDark, onAttend, onAddContact }: { ev: PublicEvent; t: ReturnType<typeof theme>; isDark: boolean; onAttend: (ev: PublicEvent) => void; onAddContact: (name: string) => void }) {
  const [img, setImg] = useState<"loading" | "ok" | "failed">(ev.image ? "loading" : "failed");
  const d = new Date(ev.starts_at);
  const [c1, c2] = CATEGORY_TINT[ev.category || ""] || ["#3B1A7A", "#7C3AED"];
  const place = [ev.venue, ev.city && !(ev.venue || "").includes(ev.city) ? ev.city : null].filter(Boolean).join(" · ");
  const time = isAllDay(ev.starts_at) ? "All day" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const round: React.CSSProperties = { width: 44, height: 44, borderRadius: 22, border: "none", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: t.raised, color: t.text, textDecoration: "none" };
  const addToCalendar = () => {
    // Inside the Android app a file download can't open the calendar — use Google Calendar's add page instead
    if (typeof window !== "undefined" && (window as any).ReactNativeWebView) {
      const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const allDay = isAllDay(ev.starts_at);
      const start = allDay ? ev.starts_at.slice(0, 10).replace(/-/g, "") : fmt(ev.starts_at);
      const endIso = ev.ends_at || new Date(new Date(ev.starts_at).getTime() + (allDay ? 86400000 : 7200000)).toISOString();
      const end = allDay ? endIso.slice(0, 10).replace(/-/g, "") : fmt(endIso);
      const q = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates: `${start}/${end}`, details: ev.url, location: ev.venue || ev.city || "" });
      window.location.href = `https://calendar.google.com/calendar/render?${q.toString()}`;
      return;
    }
    const blob = new Blob([icsFor(ev)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${ev.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <article role="listitem" className="nq-pop" aria-label={ev.title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ position: "relative", aspectRatio: "1.586", borderRadius: 22, overflow: "hidden", background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`, color: "#FFFFFF", boxShadow: isDark ? "0 12px 30px -14px rgba(0,0,0,0.8)" : "0 14px 32px -16px rgba(40,20,90,0.45)" }}>
        {ev.image && img !== "failed" && (
          <img src={ev.image} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={() => setImg("ok")} onError={() => setImg("failed")} className={`nq-fade${img === "ok" ? " is-loaded" : ""}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        )}
        {img === "failed" && (
          <span aria-hidden style={{ position: "absolute", right: -18, bottom: -26, opacity: 0.14, color: "#FFFFFF" }}>
            <I.Calendar size={150} strokeWidth={1.2} />
          </span>
        )}
        <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.25) 55%, rgba(0,0,0,0.82) 100%)" }} />
        {/* Date tile */}
        <div style={{ position: "absolute", top: 14, left: 14, width: 52, borderRadius: 14, overflow: "hidden", textAlign: "center", background: "rgba(255,255,255,0.94)", color: "#1C1C1E", boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", background: "#7C3AED", color: "#FFFFFF", padding: "3px 0" }}>{d.toLocaleDateString([], { month: "short" })}</div>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, padding: "5px 0 2px" }}>{d.getDate()}</div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#6E6E73", paddingBottom: 4 }}>{d.toLocaleDateString([], { weekday: "short" })}</div>
        </div>
        {ev.category && (
          <span style={{ position: "absolute", top: 14, right: 14, display: "inline-flex", alignItems: "center", height: 28, padding: "0 12px", borderRadius: 14, fontSize: 12, fontWeight: 600, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", color: "#FFFFFF" }}>{ev.category}</span>
        )}
        <div style={{ position: "absolute", left: 16, right: 16, bottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.01em", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", textShadow: "0 1px 6px rgba(0,0,0,0.35)" } as React.CSSProperties}>{ev.title}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.88)", overflow: "hidden" }}>
            <I.Clock size={14} /> <span style={{ flexShrink: 0 }}>{time}</span>
            {place && (
              <>
                <span aria-hidden style={{ opacity: 0.6 }}>·</span>
                <I.MapPin size={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{place}</span>
              </>
            )}
          </div>
          {(ev.organizer || ev.verified) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
              {ev.organizer && (
                <>
                  <span aria-hidden style={{ width: 18, height: 18, borderRadius: 9, background: "rgba(255,255,255,0.25)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#FFFFFF" }}>{ev.organizer.trim().charAt(0).toUpperCase()}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>By {ev.organizer}</span>
                </>
              )}
              {ev.verified && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#7CF0A0", fontWeight: 600, flexShrink: 0 }}>
                  <I.Check size={13} strokeWidth={2.6} /> Verified
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => onAttend(ev)} aria-label={`Going to ${ev.title} — opens its Radar`} className="btn-press" style={{ flex: 1, minHeight: 44, borderRadius: 22, border: "none", background: PURPLE, color: "#FFFFFF", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <I.Check size={17} strokeWidth={2.4} /> Going
        </button>
        <button onClick={addToCalendar} aria-label={`Add ${ev.title} to calendar`} title="Add to calendar" style={round}>
          <I.Calendar size={18} />
        </button>
        <a href={ev.url} target="_blank" rel="noopener noreferrer" aria-label={`Event page on ${ev.source_host}`} title={`Open on ${ev.source_host}`} style={round}>
          <I.Globe size={18} />
        </a>
        <button onClick={() => onAddContact(ev.title)} aria-label={`Add a contact met at ${ev.title}`} title="Add someone you met here" style={round}>
          <I.UserPlus size={18} />
        </button>
      </div>
    </article>
  );
}

function Sheet({ title, t, onClose, children }: { title: string; t: ReturnType<typeof theme>; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 400, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div className="nq-backdrop" onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} />
      <div className="nq-sheet-up" style={{ position: "relative", width: "100%", maxWidth: 520, maxHeight: "86dvh", overflowY: "auto", background: t.surface, color: t.text, borderRadius: "28px 28px 0 0", padding: "10px 20px calc(24px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)))", boxSizing: "border-box" }}>
        <div aria-hidden style={{ width: 36, height: 5, borderRadius: 3, background: t.border, margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 16, border: "none", background: t.raised, color: t.muted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <I.X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Month calendar: days with events get a dot; past days are dimmed
function MonthPicker({ t, isDark, selected, busyDays, onPick }: { t: ReturnType<typeof theme>; isDark: boolean; selected: string | null; busyDays: Set<string>; onPick: (day: string) => void }) {
  const today = new Date(new Date().toDateString());
  const [month, setMonth] = useState(() => (selected ? new Date(selected + "T00:00:00") : today));
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const key = (d: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const canPrev = month.getFullYear() > today.getFullYear() || month.getMonth() > today.getMonth();
  const nav: React.CSSProperties = { width: 40, height: 40, borderRadius: 20, border: "none", background: t.raised, color: t.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button aria-label="Previous month" disabled={!canPrev} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={{ ...nav, opacity: canPrev ? 1 : 0.35 }}>
          <I.ChevronLeft size={20} />
        </button>
        <div style={{ fontSize: 17, fontWeight: 600 }}>{month.toLocaleDateString([], { month: "long", year: "numeric" })}</div>
        <button aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={nav}>
          <I.ChevronLeft size={20} style={{ transform: "rotate(180deg)" }} />
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, textAlign: "center" }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
          <div key={i} style={{ fontSize: 12, color: t.muted, fontWeight: 600, padding: "4px 0" }}>{w}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} />;
          const k = key(d);
          const past = new Date(k + "T00:00:00") < today;
          const on = selected === k;
          const isToday = new Date(k + "T00:00:00").getTime() === today.getTime();
          const busy = busyDays.has(k);
          return (
            <button key={k} disabled={past} onClick={() => onPick(k)} aria-label={`${new Date(k + "T00:00:00").toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}${busy ? ", has events" : ""}`} aria-pressed={on} style={{ position: "relative", aspectRatio: "1", borderRadius: 999, border: "none", cursor: past ? "default" : "pointer", fontSize: 15, fontWeight: on || isToday ? 700 : 500, background: on ? PURPLE : "transparent", color: on ? "#FFFFFF" : past ? (isDark ? "#48484A" : "#C7C7CC") : isToday ? PURPLE : t.text }}>
              {d}
              {busy && !past && <span aria-hidden style={{ position: "absolute", left: "50%", bottom: 5, width: 4, height: 4, marginLeft: -2, borderRadius: 2, background: on ? "#FFFFFF" : PURPLE }} />}
            </button>
          );
        })}
      </div>
      <p style={{ fontSize: 13, color: t.muted, margin: "12px 0 0", textAlign: "center" }}>Days with a dot have events.</p>
    </div>
  );
}

// Featured events hero (BookMyShow / District style): auto-advances every 5 s with a smooth slide,
// swipeable, dots show where you are; pauses while touched/hovered and when motion is reduced.
function HeroCarousel({ events, cityMatch, isDark, onAttend }: { events: PublicEvent[]; cityMatch: (e: PublicEvent) => boolean; isDark: boolean; onAttend: (ev: PublicEvent) => void }) {
  const featured = useMemo(() => {
    const now = Date.now();
    const soon = (e: PublicEvent) => {
      const t = new Date(e.starts_at).getTime();
      return t >= now - 3 * 3600e3 && t <= now + 21 * 86400e3;
    };
    const withImg = events.filter((e) => e.image && soon(e));
    const local = withImg.filter(cityMatch);
    const pool = (local.length >= 3 ? local : withImg).slice();
    const india = (e: PublicEvent) => (INDIA_CITIES.has(e.city || "") ? 1 : 0); // India-first when no city is chosen
    pool.sort((a, b) => india(b) - india(a) || Number(b.verified) - Number(a.verified) || new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    return pool.slice(0, 6);
  }, [events, cityMatch]);
  const track = React.useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const paused = React.useRef(false);
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const goTo = useCallback((i: number) => {
    const el = track.current;
    if (!el) return;
    const n = el.children.length;
    const next = ((i % n) + n) % n;
    el.scrollTo({ left: next * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  }, [reduce]);

  // which slide is showing (from the scroll position — works for swipes too)
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [featured.length]);

  // auto-advance
  useEffect(() => {
    if (reduce || featured.length < 2) return;
    const t = setInterval(() => {
      if (!paused.current && document.visibilityState === "visible") goTo(index + 1);
    }, 5000);
    return () => clearInterval(t);
  }, [index, featured.length, goTo, reduce]);

  if (featured.length === 0) return null;
  const hold = { onPointerDown: () => (paused.current = true), onPointerUp: () => setTimeout(() => (paused.current = false), 2500), onMouseEnter: () => (paused.current = true), onMouseLeave: () => (paused.current = false) };

  return (
    <section aria-label="Featured events" aria-roledescription="carousel" style={{ position: "relative", margin: "0 -16px" }}>
      <div ref={track} className="nq-chips" {...hold} style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", scrollBehavior: reduce ? "auto" : "smooth", scrollbarWidth: "none" } as React.CSSProperties}>
        {featured.map((ev, i) => {
          const d = new Date(ev.starts_at);
          const allDay = isAllDay(ev.starts_at);
          const when = `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}${allDay ? "" : ` · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}`;
          const place = [ev.venue, ev.city && !(ev.venue || "").includes(ev.city) ? ev.city : null].filter(Boolean).join(" · ");
          return (
            <div key={ev.id} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${featured.length}: ${ev.title}`} style={{ flex: "0 0 100%", scrollSnapAlign: "center", padding: "0 16px", boxSizing: "border-box" }}>
              <div style={{ position: "relative", aspectRatio: "16 / 10", borderRadius: 24, overflow: "hidden", background: "linear-gradient(135deg, #3B1A7A, #7C3AED)", color: "#FFFFFF", boxShadow: isDark ? "0 16px 36px -18px rgba(0,0,0,0.9)" : "0 18px 40px -20px rgba(40,20,90,0.55)" }}>
                <img src={ev.image!} alt="" referrerPolicy="no-referrer" loading={i === 0 ? "eager" : "lazy"} onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.05) 25%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.88) 100%)" }} />
                <span style={{ position: "absolute", top: 14, left: 14, display: "inline-flex", alignItems: "center", height: 28, padding: "0 12px", borderRadius: 14, fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", background: "rgba(124,58,237,0.92)" }}>Featured</span>
                <div style={{ position: "absolute", left: 18, right: 18, bottom: 16, display: "flex", alignItems: "flex-end", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>{when}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", textShadow: "0 1px 8px rgba(0,0,0,0.4)" } as React.CSSProperties}>{ev.title}</div>
                    {place && <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{place}</div>}
                  </div>
                  <button onClick={() => onAttend(ev)} aria-label={`Going to ${ev.title} — opens its Radar`} className="btn-press" style={{ flexShrink: 0, minHeight: 44, padding: "0 18px", borderRadius: 22, border: "none", background: "#FFFFFF", color: "#1C1C1E", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                    Going
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {featured.length > 1 && (
        <div role="tablist" aria-label="Choose featured event" style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 10 }}>
          {featured.map((ev, i) => (
            <button key={ev.id} role="tab" aria-selected={index === i} aria-label={`Show ${ev.title}`} onClick={() => goTo(i)} style={{ width: index === i ? 22 : 8, height: 8, borderRadius: 4, border: "none", padding: 0, cursor: "pointer", background: index === i ? PURPLE : isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.18)", transition: "width 0.3s ease, background 0.3s ease" }} />
          ))}
        </div>
      )}
    </section>
  );
}
