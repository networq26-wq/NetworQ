/**
 * NetworQBot — keeps the Events Hub filled with real upcoming events.
 *
 * Reads only public schema.org Event data from listing/event pages, honours
 * robots.txt, identifies itself, waits between requests per host, caps volume,
 * and always stores the source URL so every event links back to its organiser.
 */
const { extractJsonLdEvents } = require("./events");
const { assertPublicUrl } = require("./enrich");

const USER_AGENT = "Mozilla/5.0 (compatible; NetworQBot/1.0; +https://www.networq.co.in/bot)";
const DEFAULT_DELAY_MS = 1500;
const MAX_PAGE_BYTES = 2_000_000;

const INDIA = ["Hyderabad", "Bengaluru", "Mumbai", "Delhi", "Pune", "Chennai", "Kolkata", "Ahmedabad"];

const slug = (city) =>
  ({ Bengaluru: "bangalore", Delhi: "delhi", "San Francisco": "sf", "New York": "nyc" })[city] || city.toLowerCase().replace(/\s+/g, "-");

function buildSources() {
  const s = [];
  // Luma city pages → event pages (worldwide tech/startup scene)
  for (const city of ["Bengaluru", "Mumbai", "Delhi", "San Francisco", "New York", "London", "Singapore", "Dubai", "Berlin", "Toronto", "Sydney", "Tokyo", "Paris"]) {
    s.push({ id: `luma:${city}`, kind: "links", city, url: `https://lu.ma/${slug(city)}`, linkPattern: /href="\/([a-z0-9][a-z0-9-]{4,})"/gi, linkBase: "https://lu.ma/", limit: 12, delayMs: 1500 });
  }
  // AllEvents city listings carry Event JSON-LD directly (India).
  // Meetup's robots.txt disallows its search pages for bots, and BookMyShow / Insider refuse automated
  // requests, so events from those sites come from pasted links only.
  for (const city of INDIA) {
    for (const cat of ["business", "tech", "startups"]) {
      s.push({ id: `allevents:${city}:${cat}`, kind: "listing", city, url: `https://allevents.in/${slug(city)}/${cat}`, delayMs: 10000 });
    }
  }
  // Eventbrite listings → event pages (India + global hubs)
  const eb = {
    Hyderabad: "india--hyderabad", Bengaluru: "india--bangalore", Mumbai: "india--mumbai", Delhi: "india--new-delhi",
    Pune: "india--pune", Chennai: "india--chennai", Kolkata: "india--kolkata", Ahmedabad: "india--ahmedabad",
    "New York": "ny--new-york", London: "united-kingdom--london", Singapore: "singapore--singapore", Dubai: "united-arab-emirates--dubai",
    "San Francisco": "ca--san-francisco", Toronto: "canada--toronto", Sydney: "australia--sydney", Berlin: "germany--berlin",
  };
  for (const [city, path] of Object.entries(eb)) {
    for (const cat of ["business", "science-and-tech"]) {
      s.push({ id: `eventbrite:${city}:${cat}`, kind: "links", city, url: `https://www.eventbrite.com/d/${path}/${cat}--events/`, linkPattern: /(https:\/\/www\.eventbrite\.[a-z.]+\/e\/[a-z0-9-]+)/gi, linkBase: "", limit: 8, delayMs: 1500 });
    }
  }
  return s;
}

const RESERVED_LUMA = /^(discover|signin|login|signup|create|pricing|explore|home|calendar|user|help|terms|privacy|ios|android|download|about|careers|blog|changelog|events|hosting|api)/;

// ── robots.txt (User-agent: * and NetworQBot groups; Disallow/Allow with * and $) ──
function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, field, value] = [m[0], m[1].toLowerCase(), m[2].trim()];
    if (field === "user-agent") {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if ((field === "disallow" || field === "allow") && current) {
      current.rules.push({ allow: field === "allow", path: value });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a === "networqbot"));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  return rules.filter((r) => r.path);
}

function robotsAllows(rules, pathWithQuery) {
  let best = null;
  for (const r of rules) {
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(pathWithQuery) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

function createCrawler({ fetchText, saveEvents, deleteBefore, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log, sources = buildSources() }) {
  const robotsCache = new Map();
  const lastHit = new Map();

  async function allowed(url) {
    const u = new URL(url);
    if (!robotsCache.has(u.host)) {
      let rules = [];
      try {
        rules = parseRobots(await fetchText(`${u.protocol}//${u.host}/robots.txt`));
      } catch {
        rules = []; // no robots.txt → allowed
      }
      robotsCache.set(u.host, rules);
    }
    return robotsAllows(robotsCache.get(u.host), u.pathname + u.search);
  }

  async function politeFetch(url, delayMs) {
    const host = new URL(url).host;
    const wait = (lastHit.get(host) || 0) + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    return fetchText(url);
  }

  async function crawlSource(src) {
    if (!(await allowed(src.url))) return { events: [], skipped: "robots" };
    const html = await politeFetch(src.url, src.delayMs || DEFAULT_DELAY_MS);
    if (src.kind === "listing") return { events: extractJsonLdEvents(html, src.url) };

    const links = [];
    for (const m of html.matchAll(src.linkPattern)) {
      const href = src.linkBase ? src.linkBase + m[1] : m[1];
      if (src.linkBase && RESERVED_LUMA.test(m[1])) continue;
      if (!links.includes(href)) links.push(href);
      if (links.length >= src.limit) break;
    }
    const events = [];
    for (const link of links) {
      try {
        if (!(await allowed(link))) continue;
        events.push(...extractJsonLdEvents(await politeFetch(link, src.delayMs || DEFAULT_DELAY_MS), link));
      } catch {
        /* one bad page never stops the run */
      }
    }
    return { events };
  }

  async function run() {
    const started = Date.now();
    const horizon = Date.now() + 365 * 86400000;
    let saved = 0;
    const perSource = {};
    for (const src of sources) {
      try {
        const { events, skipped } = await crawlSource(src);
        const upcoming = events
          .filter((e) => {
            const t = new Date(e.starts_at).getTime();
            return t > Date.now() - 3600000 && t < horizon;
          })
          .map((e) => ({ ...e, city: src.city, source: "crawler", last_seen_at: new Date().toISOString() }));
        const unique = [...new Map(upcoming.map((e) => [e.url, e])).values()];
        if (unique.length) await saveEvents(unique);
        saved += unique.length;
        perSource[src.id] = skipped || unique.length;
      } catch (err) {
        perSource[src.id] = `error: ${err.message}`;
      }
    }
    const removed = deleteBefore ? await deleteBefore(new Date(Date.now() - 7 * 86400000).toISOString()).catch(() => 0) : 0;
    log(`[Events] crawl finished in ${Math.round((Date.now() - started) / 1000)}s — ${saved} upcoming events saved, ${removed} old removed`, perSource);
    return { saved, removed, perSource };
  }

  return { run, crawlSource, allowed };
}

async function botFetchText(url) {
  await assertPublicUrl(new URL(url));
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return text.length > MAX_PAGE_BYTES ? text.slice(0, MAX_PAGE_BYTES) : text;
}

function startEventsCrawler(admin, { everyMs = 6 * 3600 * 1000, firstRunDelayMs = 90_000 } = {}) {
  const crawler = createCrawler({
    fetchText: botFetchText,
    async saveEvents(rows) {
      const { error } = await admin.from("public_events").upsert(rows, { onConflict: "url" });
      if (error) throw new Error(error.message);
    },
    async deleteBefore(iso) {
      const { data, error } = await admin.from("public_events").delete().lt("starts_at", iso).select("id");
      if (error) throw new Error(error.message);
      return data.length;
    },
  });
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await crawler.run();
    } catch (err) {
      console.error("[Events] crawl failed:", err.message);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, firstRunDelayMs);
  const timer = setInterval(tick, everyMs);
  console.log("[Events] NetworQBot scheduled — refreshing real events every 6 hours");
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

module.exports = { createCrawler, startEventsCrawler, parseRobots, robotsAllows, buildSources, USER_AGENT };
