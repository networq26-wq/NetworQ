/**
 * Events import: turns a real event page (schema.org Event JSON-LD, published by
 * Luma, Eventbrite, Meetup, Townscript…) or an .ics calendar feed into
 * public_events rows. Nothing is invented: events without a name and start
 * time are skipped, and every row keeps its source URL.
 */
const express = require("express");
const ical = require("node-ical");
const { createClient } = require("@supabase/supabase-js");
const { fetchHtml, assertPublicUrl } = require("./enrich");

const MAX_FEED_EVENTS = 50;

const decode = (s) =>
  typeof s === "string"
    ? s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/<[^>]+>/g, "")
        .trim()
    : null;

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || null);
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};
const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
const toIso = (d) => {
  const t = d instanceof Date ? d : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

function typesOf(node) {
  const t = node && node["@type"];
  return (Array.isArray(t) ? t : [t]).filter(Boolean).map(String);
}

function* walk(node) {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
  } else if (node && typeof node === "object") {
    yield node;
    if (node["@graph"]) yield* walk(node["@graph"]);
  }
}

function placeOf(location) {
  const loc = Array.isArray(location) ? location[0] : location;
  if (!loc) return { venue: null, city: null };
  if (typeof loc === "string") return { venue: decode(loc), city: null };
  if (typesOf(loc).includes("VirtualLocation")) return { venue: "Online", city: null };
  const addr = loc.address;
  const street = typeof addr === "string" ? addr : addr?.streetAddress;
  const city = typeof addr === "object" ? addr?.addressLocality : null;
  const venue = [decode(loc.name), decode(street)].filter(Boolean).join(", ") || null;
  return { venue, city: decode(city) || null };
}

function imageOf(img) {
  const first = Array.isArray(img) ? img[0] : img;
  const url = typeof first === "string" ? first : first?.url;
  return isHttp(url) ? url : null;
}

function extractJsonLdEvents(html, pageUrl) {
  const out = [];
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const raw = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const node of walk(json)) {
      if (!typesOf(node).some((t) => /Event$/.test(t))) continue;
      const title = decode(node.name);
      const starts_at = toIso(node.startDate);
      if (!title || !starts_at) continue;
      const { venue, city } = placeOf(node.location);
      const url = isHttp(node.url) ? node.url : pageUrl;
      out.push({
        title: clip(title, 200),
        starts_at,
        ends_at: node.endDate ? toIso(node.endDate) : null,
        venue: clip(venue, 200),
        city,
        url,
        source_host: hostOf(url),
        image: imageOf(node.image),
        description: clip(decode(node.description), 4000),
        organizer: clip(decode(Array.isArray(node.organizer) ? node.organizer[0]?.name : node.organizer?.name), 200),
      });
    }
  }
  return out;
}

function parseIcsEvents(text, feedUrl, now = new Date()) {
  const data = ical.sync.parseICS(text);
  return Object.values(data)
    .filter((e) => e && e.type === "VEVENT" && e.start && e.summary && new Date(e.start) > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))
    .slice(0, MAX_FEED_EVENTS)
    .map((e) => {
      const rawUrl = typeof e.url === "object" ? e.url?.val : e.url;
      const url = isHttp(rawUrl) ? rawUrl : `${feedUrl}#${encodeURIComponent(e.uid || String(e.start))}`;
      const summary = typeof e.summary === "object" ? e.summary.val : e.summary;
      const description = typeof e.description === "object" ? e.description.val : e.description;
      const location = typeof e.location === "object" ? e.location.val : e.location;
      return {
        title: clip(decode(summary), 200),
        starts_at: toIso(e.start),
        ends_at: e.end ? toIso(e.end) : null,
        venue: clip(decode(location), 200),
        city: null,
        url,
        source_host: hostOf(url),
        image: null,
        description: clip(decode(description), 4000),
        organizer: null,
      };
    })
    .filter((e) => e.title && e.starts_at);
}

const looksLikeIcs = (url, body) => /\.ics(\?|$)|\/ics\//i.test(url) || /^\s*BEGIN:VCALENDAR/.test(body);

function createEventsRouter(deps) {
  const router = express.Router();
  router.post("/events/import", async (req, res) => {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const user = token ? await deps.getUser(token).catch(() => null) : null;
    if (!user) return res.status(401).json({ error: "Please sign in again." });

    let url = String(req.body?.url || "").trim();
    if (url && !/^https?:\/\//i.test(url) && !/^[a-z]+:/i.test(url)) url = `https://${url}`;
    if (!isHttp(url) || url.length > 2000) return res.status(400).json({ error: "Paste a link to an event page or calendar (.ics)." });

    let body;
    try {
      body = await deps.fetchText(url);
    } catch (err) {
      return res.status(422).json({ error: `Couldn't open that link (${err.message}).` });
    }
    const events = looksLikeIcs(url, body) ? parseIcsEvents(body, url) : extractJsonLdEvents(body, url);
    const upcoming = events.filter((e) => new Date(e.starts_at) > new Date(Date.now() - 6 * 3600 * 1000));
    if (!upcoming.length) {
      return res.status(422).json({ error: "We couldn't find event details on that page. Try the event's own page on Luma, Eventbrite, Meetup or Townscript, or a calendar (.ics) link." });
    }
    const saved = await deps.saveEvents(upcoming.map((e) => ({ ...e, created_by: user.id })));
    res.json({ ok: true, events: saved });
  });
  return router;
}

function productionDeps() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async getUser(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error ? null : data.user;
    },
    async fetchText(target) {
      await assertPublicUrl(new URL(target));
      return fetchHtml(target, 8000);
    },
    async saveEvents(rows) {
      // Re-importing the same URL refreshes its details (title, time, venue)
      const { data, error } = await admin.from("public_events").upsert(rows, { onConflict: "url" }).select();
      if (error) throw new Error(error.message);
      return data;
    },
  };
}

module.exports = { createEventsRouter, productionDeps, extractJsonLdEvents, parseIcsEvents };
