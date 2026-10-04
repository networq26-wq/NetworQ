// "Coming up near you": the next real events in the city you chose in Events, right on home.
import React, { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { I } from "../ui/icons";

type Ev = { id: string; title: string; starts_at: string; venue: string | null; city: string | null; image: string | null; category?: string | null };
const INDIA = new Set(["Hyderabad", "Bengaluru", "Mumbai", "Delhi", "Pune", "Chennai", "Kolkata", "Ahmedabad", "Gurugram", "Noida", "Kochi", "Jaipur"]);

function savedCity(): string {
  try {
    return JSON.parse(localStorage.getItem("networq.events.filters") || "{}").city || "All";
  } catch {
    return "All";
  }
}

export function ComingUp({ supabase, isDark, onOpenEvents }: { supabase: SupabaseClient; isDark: boolean; onOpenEvents: () => void }) {
  const [items, setItems] = useState<Ev[] | null>(null);
  const [scope, setScope] = useState("");
  const city = savedCity();
  useEffect(() => {
    let alive = true;
    const now = new Date();
    const week = new Date(Date.now() + 7 * 86400000);
    let q = supabase.from("public_events").select("id,title,starts_at,venue,city,image,category").gte("starts_at", now.toISOString()).lt("starts_at", week.toISOString()).order("starts_at", { ascending: true }).limit(200);
    if (city !== "All" && city !== "All India" && city !== "Worldwide" && city !== "Online") q = q.eq("city", city);
    q.then(({ data }) => {
      if (!alive) return;
      let list = (data || []) as Ev[];
      let label = city === "All" ? "" : city;
      if (city === "All India") list = list.filter((e) => INDIA.has(e.city || ""));
      if (city === "All") {
        // No city chosen yet: India first (NetworQ is India-first), worldwide only if India has nothing
        const india = list.filter((e) => INDIA.has(e.city || ""));
        if (india.length) {
          list = india;
          label = "India";
        }
      }
      setScope(label);
      setItems(list.slice(0, 6));
    }, () => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [supabase, city]);

  if (!items || items.length === 0) return null;
  const t = isDark ? { text: "#FFFFFF", muted: "#AEAEB2" } : { text: "#1C1C1E", muted: "#6E6E73" };
  const where = scope ? ` in ${scope}` : "";
  return (
    <section aria-label="Coming up near you" style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Coming up{where}</h2>
          <div style={{ fontSize: 13, color: t.muted, marginTop: 2 }}>Real events this week — great places to meet people</div>
        </div>
        <button onClick={onOpenEvents} style={{ border: "none", background: "none", color: isDark ? "#C4B5FD" : "#7C3AED", fontSize: 15, fontWeight: 600, cursor: "pointer", flexShrink: 0, minHeight: 32, padding: 0 }}>
          See all
        </button>
      </div>
      <div className="nq-chips" style={{ display: "flex", gap: 12, overflowX: "auto", scrollSnapType: "x mandatory", scrollbarWidth: "none", margin: "0 -16px", padding: "2px 16px 6px", scrollPaddingLeft: 16 } as React.CSSProperties}>
        {items.map((e) => {
          const d = new Date(e.starts_at);
          const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
          // Date-only events are stored at midnight UTC — show "All day", not a fake 5:30 AM
          const allDay = /T00:00:00(\.0+)?(Z|\+00:00)$/.test(e.starts_at);
          const when = `${days === 0 ? "Today" : days === 1 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · ${allDay ? "All day" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
          return (
            <button
              key={e.id}
              onClick={onOpenEvents}
              aria-label={`${e.title}, ${when}`}
              className="btn-press"
              style={{ all: "unset", boxSizing: "border-box", flex: "0 0 auto", width: 220, scrollSnapAlign: "start", cursor: "pointer", borderRadius: 18, overflow: "hidden", position: "relative", aspectRatio: "1.586", background: "linear-gradient(135deg, #3B1A7A, #7C3AED)", color: "#FFFFFF", boxShadow: isDark ? "0 8px 20px -10px rgba(0,0,0,0.8)" : "0 10px 22px -12px rgba(40,20,90,0.45)" }}
            >
              {e.image && <img src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(ev) => ((ev.target as HTMLImageElement).style.display = "none")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
              <span aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.82) 100%)" }} />
              <span style={{ position: "absolute", left: 12, right: 12, bottom: 10 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
                  <I.Calendar size={13} /> {when}
                </span>
                <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 15, fontWeight: 700, lineHeight: 1.25, marginTop: 4 } as React.CSSProperties}>{e.title}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
