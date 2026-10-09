// Waitlist reports — pure functions over sign-up rows (no database access), so they're easy to test.
const DAY = 24 * 3600 * 1000;
const IST_OFFSET = 5.5 * 3600 * 1000;

// Calendar day in India (YYYY-MM-DD)
const istDay = (t) => new Date(new Date(t).getTime() + IST_OFFSET).toISOString().slice(0, 10);
const ms = (r) => (r.created_at ? new Date(r.created_at).getTime() : 0);

const FREE_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.in", "yahoo.co.in", "ymail.com", "rocketmail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "rediffmail.com", "protonmail.com", "proton.me", "zoho.com", "zohomail.in", "gmx.com", "mail.com", "yandex.com",
]);

const RANGES = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };

// Filters from the query string: range | from/to, status, tag, source, q
function parseFilters(query = {}) {
  const pick = (v) => (Array.isArray(v) ? v[0] : v);
  const str = (v, max = 80) => String(pick(v) ?? "").trim().slice(0, max);
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : "");
  const range = Object.prototype.hasOwnProperty.call(RANGES, str(query.range)) ? str(query.range) : "";
  const from = date(query.from);
  const to = date(query.to);
  const status = ["waiting", "invited", "joined"].includes(str(query.status)) ? str(query.status) : "";
  return { range: range || (from || to ? "" : "all"), from, to, status, tag: str(query.tag, 40).toLowerCase(), source: str(query.source, 60), q: str(query.q, 120).toLowerCase() };
}

function inRange(r, f, now = Date.now()) {
  const t = ms(r);
  if (f.from && istDay(t) < f.from) return false;
  if (f.to && istDay(t) > f.to) return false;
  if (f.range === "today") return istDay(t) === istDay(now);
  const days = { "7d": 7, "30d": 30, "90d": 90 }[f.range];
  return days ? t > now - days * DAY : true;
}

// One name per platform, whether it came from a utm tag or the referring page
const PLATFORMS = [
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "linkedin"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)facebook\.com$|^fb\.me$/, "facebook"],
  [/(^|\.)(twitter|x)\.com$|^t\.co$/, "x / twitter"],
  [/(^|\.)whatsapp\.com$|^wa\.me$/, "whatsapp"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "youtube"],
  [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)networq\.co\.in$/, "networq"],
];
const UTM_ALIASES = { ig: "instagram", insta: "instagram", li: "linkedin", fb: "facebook", twitter: "x / twitter", x: "x / twitter", wa: "whatsapp" };
const platform = (host) => (PLATFORMS.find(([re]) => re.test(host)) || [null, host])[1];

const sourceOf = (r) => {
  if (r.utm_source) {
    const u = r.utm_source.toLowerCase();
    return UTM_ALIASES[u] || platform(u.replace(/^www\./, ""));
  }
  if (r.referrer) {
    try {
      return platform(new URL(r.referrer).hostname.replace(/^www\./, "").toLowerCase());
    } catch {
      /* not a URL */
    }
  }
  return "direct";
};

function filterRows(rows, f, now = Date.now()) {
  return rows.filter(
    (r) =>
      inRange(r, f, now) &&
      (!f.status || (r.status || "waiting") === f.status) &&
      (!f.tag || (r.tags || []).map((t) => t.toLowerCase()).includes(f.tag)) &&
      (!f.source || sourceOf(r) === f.source.toLowerCase()) &&
      (!f.q || `${r.email} ${r.position ?? ""} ${(r.tags || []).join(" ")} ${r.notes || ""}`.toLowerCase().includes(f.q))
  );
}

// Daily sign-ups for the last `days` days (oldest first)
function dailySeries(rows, days = 30, now = Date.now()) {
  const out = [];
  const counts = new Map();
  for (const r of rows) counts.set(istDay(ms(r)), (counts.get(istDay(ms(r))) || 0) + 1);
  for (let i = days - 1; i >= 0; i--) {
    const d = istDay(now - i * DAY);
    out.push({ day: d, count: counts.get(d) || 0 });
  }
  return out;
}

function kpis(rows, now = Date.now()) {
  const today = istDay(now);
  const last7 = rows.filter((r) => ms(r) > now - 7 * DAY).length;
  const prev7 = rows.filter((r) => ms(r) <= now - 7 * DAY && ms(r) > now - 14 * DAY).length;
  const by = (s) => rows.filter((r) => (r.status || "waiting") === s).length;
  return {
    total: rows.length,
    today: rows.filter((r) => istDay(ms(r)) === today).length,
    last7,
    prev7,
    growth: prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : null, // null = nothing to compare with
    waiting: by("waiting"),
    invited: by("invited"),
    joined: by("joined"),
  };
}

const topCounts = (rows, keyFn, limit = 10) => {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, limit);
};

function domains(rows, limit = 12) {
  const list = topCounts(rows, (r) => String(r.email || "").split("@")[1]?.toLowerCase(), 1000);
  const company = list.filter((d) => !FREE_DOMAINS.has(d.key));
  const personal = rows.length - company.reduce((n, d) => n + d.count, 0);
  return { top: list.slice(0, limit).map((d) => ({ ...d, kind: FREE_DOMAINS.has(d.key) ? "personal" : "company" })), companies: company.slice(0, limit), personal, companyCount: rows.length - personal };
}

const sources = (rows) => topCounts(rows, sourceOf, 12);
const campaigns = (rows) => topCounts(rows, (r) => r.utm_campaign, 12);
const devices = (rows) => topCounts(rows, (r) => r.device || "unknown", 5);
const timezones = (rows) => topCounts(rows, (r) => r.timezone || "unknown", 10);

// Who brought the most people (by their referral code)
function referrals(rows, limit = 10) {
  const byCode = new Map(rows.filter((r) => r.ref_code).map((r) => [r.ref_code, r]));
  const counts = topCounts(rows, (r) => r.referred_by, 1000);
  const referred = counts.reduce((n, c) => n + c.count, 0);
  return {
    referred,
    top: counts
      .filter((c) => byCode.has(c.key))
      .slice(0, limit)
      .map((c) => ({ email: byCode.get(c.key).email, id: byCode.get(c.key).id, count: c.count })),
  };
}

const referralCounts = (rows) => {
  const m = new Map();
  for (const r of rows) if (r.referred_by) m.set(r.referred_by, (m.get(r.referred_by) || 0) + 1);
  return m;
};

// Who gets invited first: most referrals, then earliest in the queue ("Share & move up the queue")
function priorityOrder(rows) {
  const refs = referralCounts(rows);
  return rows
    .filter((r) => (r.status || "waiting") === "waiting")
    .map((r) => ({ ...r, referrals: refs.get(r.ref_code) || 0 }))
    .sort((a, b) => b.referrals - a.referrals || (a.position ?? 1e9) - (b.position ?? 1e9));
}

function emailHealth(rows) {
  const failed = rows.filter((r) => !r.notified && r.email_error);
  return {
    sent: rows.filter((r) => r.notified).length,
    queued: rows.filter((r) => !r.notified && !r.email_error).length,
    failed: failed.length,
    failedRows: failed.slice(0, 20),
  };
}

const allTags = (rows) => topCounts(rows.flatMap((r) => (r.tags || []).map((t) => ({ t }))), (x) => x.t.toLowerCase(), 50);

module.exports = {
  RANGES, FREE_DOMAINS, istDay, parseFilters, filterRows, dailySeries, kpis, domains, sources, campaigns, devices,
  timezones, referrals, referralCounts, priorityOrder, emailHealth, allTags, sourceOf,
};
