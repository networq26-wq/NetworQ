// Admin panel HTML — light CRM layout, rounded everywhere, one shared gutter, official NetworQ wordmark.
const R = require("./reports");

const LOGO = "/brand/networq-wordmark.png";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const n = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-IN"));
const fmtDate = (t, withTime = true) =>
  t ? new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }) : "—";
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null)).toString();

const STYLE = `
:root {
  --brand: #4B3BEA; --brand-dark: #3A2BC9; --brand-soft: #EEECFD;
  --page: #F3F3F5; --surface: #FFFFFF; --soft: #F8F8FA; --border: #DDDBE3; --border-soft: #ECEBF2; --border-strong: #C9C7D1;
  --text: #181818; --text-2: #444; --muted: #706E78;
  --ok-bg: #E3F5E9; --ok: #2E844A; --warn-bg: #FEF1E3; --warn: #A96404; --err-bg: #FDECEA; --err: #BA0517; --info-bg: #E8F1FD; --info: #0B5CAB;
  --r-lg: 18px; --r-md: 12px; --r-sm: 10px; --pad: 20px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 13px; color: var(--text); background: var(--page); min-height: 100vh; -webkit-font-smoothing: antialiased; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
button, input, select, textarea { font: inherit; color: inherit; }
h1 { font-size: 18px; font-weight: 700; line-height: 1.25; }
h2 { font-size: 14px; font-weight: 700; }

.global { height: 56px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 var(--pad); gap: 12px; }
.global img { height: 24px; display: block; }
.user { display: flex; align-items: center; gap: 10px; color: var(--text-2); }
.avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--brand); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 12px; text-transform: uppercase; flex: none; }
.appnav { background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 8px var(--pad); gap: 6px; overflow-x: auto; scrollbar-width: none; }
.appnav::-webkit-scrollbar { display: none; }
.appname { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; padding-right: 14px; margin-right: 6px; border-right: 1px solid var(--border); height: 24px; flex: none; }
.launcher { display: grid; grid-template-columns: repeat(3, 4px); gap: 3px; }
.launcher i { width: 4px; height: 4px; border-radius: 50%; background: var(--muted); }
.tab { display: inline-flex; align-items: center; height: 32px; padding: 0 14px; border-radius: 999px; font-size: 13px; color: var(--text-2); white-space: nowrap; flex: none; }
.tab:hover { background: var(--soft); text-decoration: none; }
.tab.active { color: var(--brand); background: var(--brand-soft); font-weight: 700; }

.wrap { padding: var(--pad); display: grid; gap: var(--pad); }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: 0 1px 3px rgba(16,24,40,0.06); overflow: hidden; }
.panel-body { padding: var(--pad); display: grid; gap: 16px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.title { display: flex; gap: 12px; align-items: center; }
.icon-tile { width: 40px; height: 40px; border-radius: var(--r-md); background: var(--brand); display: grid; place-items: center; flex: none; }
.eyebrow { font-size: 12px; color: var(--text-2); }
.meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

.btn { height: 36px; padding: 0 16px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--brand); border-radius: var(--r-sm); font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; white-space: nowrap; text-decoration: none !important; }
.btn:hover { background: var(--soft); }
.btn-brand { background: var(--brand); border-color: var(--brand); color: #fff; }
.btn-brand:hover { background: var(--brand-dark); }
.btn-danger { color: var(--err); border-color: #F1B7B5; }
.btn-plain { border: none; background: none; color: var(--brand); padding: 0 6px; height: auto; }

.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.kpi { padding: 14px 16px; background: var(--soft); border: 1px solid var(--border-soft); border-radius: var(--r-md); }
.kpi-label { font-size: 12px; color: var(--muted); }
.kpi-val { font-size: 22px; font-weight: 700; margin-top: 2px; }
.kpi-sub { font-size: 12px; color: var(--muted); font-weight: 500; margin-left: 4px; }
.kpi-note { font-size: 12px; font-weight: 600; margin-top: 2px; }
.up { color: var(--ok); } .down { color: var(--err); }

.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--pad); }
.card-title { padding: 16px var(--pad) 0; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.list { padding: 12px var(--pad) var(--pad); display: grid; gap: 10px; }
.bar-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; }
.bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-val { font-weight: 600; color: var(--text-2); }
.bar { grid-column: 1 / -1; height: 6px; border-radius: 999px; background: var(--soft); overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 999px; background: var(--brand); }
.empty { padding: 32px var(--pad); text-align: center; color: var(--muted); }
.chart { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; padding-top: 8px; }
.chart-y { position: relative; height: 168px; min-width: 22px; font-size: 11px; color: var(--muted); }
.chart-y span { position: absolute; right: 0; transform: translateY(-50%); line-height: 1; }
.chart-bars { height: 168px; display: flex; align-items: flex-end; gap: 4px; border-bottom: 1px solid var(--border); background: linear-gradient(to bottom, var(--border-soft) 1px, transparent 1px) 0 0 / 100% 25%; }
.chart-col { flex: 1; height: 100%; display: flex; align-items: flex-end; }
.chart-col i { display: block; width: 100%; background: #A79FF5; border-radius: 4px 4px 0 0; }
.chart-col i.today { background: var(--brand); }
.chart-col:hover i { background: var(--brand-dark); }
.chart-x { display: flex; gap: 4px; margin-top: 6px; }
.chart-x span { flex: 1; font-size: 11px; color: var(--muted); white-space: nowrap; display: flex; justify-content: center; overflow: visible; width: 0; }
.chart-x span:last-child { justify-content: flex-end; }
@media (max-width: 720px) { .chart-bars, .chart-x { gap: 2px; } }

.filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.control { height: 36px; border: 1px solid var(--border-strong); border-radius: var(--r-sm); padding: 0 12px; background: var(--surface); outline: none; max-width: 100%; }
.control:focus, .field input:focus, textarea:focus { border-color: var(--brand); box-shadow: 0 0 0 1px var(--brand); }
.search { position: relative; }
.search svg { position: absolute; left: 13px; top: 11px; }
.search .control { padding-left: 34px; border-radius: 999px; width: 240px; }

.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--r-md); }
table { width: 100%; border-collapse: collapse; }
th { background: var(--soft); text-align: left; font-size: 12px; font-weight: 700; color: var(--text-2); padding: 11px 16px; border-bottom: 1px solid var(--border); white-space: nowrap; }
td { padding: 11px 16px; border-bottom: 1px solid #EFEFF3; white-space: nowrap; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover td { background: #F7F6FE; }
td.check, th.check { width: 44px; padding-right: 0; }
input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--brand); vertical-align: middle; }
.muted { color: var(--muted); }
.pill { display: inline-block; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
.pill-ok { background: var(--ok-bg); color: var(--ok); }
.pill-warn { background: var(--warn-bg); color: var(--warn); }
.pill-err { background: var(--err-bg); color: var(--err); }
.pill-info { background: var(--info-bg); color: var(--info); }
.pill-brand { background: var(--brand-soft); color: var(--brand); }
.tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--soft); border: 1px solid var(--border-soft); color: var(--text-2); margin-right: 4px; }
.bulk { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 10px 12px; border-radius: var(--r-md); background: var(--brand-soft); }
.bulk[hidden] { display: none; }

.alert { padding: 10px 14px; border-radius: var(--r-sm); font-size: 13px; }
.alert-ok { background: var(--ok-bg); color: var(--ok); }
.alert-err { background: var(--err-bg); color: var(--err); }
.alert-warn { background: var(--warn-bg); color: var(--warn); }

.details { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0; border: 1px solid var(--border-soft); border-radius: var(--r-md); overflow: hidden; }
.detail { padding: 12px 16px; border-bottom: 1px solid var(--border-soft); border-right: 1px solid var(--border-soft); min-width: 0; }
.detail-label { font-size: 12px; color: var(--muted); }
.detail-val { margin-top: 2px; overflow-wrap: anywhere; }
.field { display: grid; gap: 6px; }
.field label { font-size: 13px; color: var(--text-2); }
.field input, textarea { width: 100%; border: 1px solid var(--border-strong); border-radius: var(--r-sm); padding: 10px 12px; background: #fff; outline: none; font-size: 14px; }
textarea { min-height: 110px; resize: vertical; }

.login { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 10vh 16px 24px; }
.login img { height: 36px; margin-bottom: 24px; }
.login-card { width: 100%; max-width: 400px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 28px; box-shadow: 0 4px 16px rgba(16,24,40,0.06); display: grid; gap: 16px; }
.login-card h1 { font-size: 16px; }
.login .btn-brand { width: 100%; height: 44px; font-size: 14px; }
.field input.big { height: 44px; padding: 0 14px; font-size: 15px; }
.fine { font-size: 12px; color: var(--muted); }

@media (max-width: 720px) {
  :root { --pad: 16px; }
  .user .who { display: none; }
  .search, .search .control { width: 100%; }
  .filters .control { flex: 1 1 140px; }
  .grid2 { grid-template-columns: 1fr; }
}`;

const ICONS = {
  users: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  chart: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/></svg>`,
  app: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>`,
  pulse: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>`,
  list: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`,
  shield: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  person: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>`,
  search: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#706E78" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
};

function page(title, body, script = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="icon" type="image/png" href="/favicon.png" />
<title>${esc(title)} | NetworQ Admin</title>
<style>${STYLE}</style>
</head>
<body>
${body}
${script}
</body>
</html>`;
}

const TABS = [
  ["", "Overview"],
  ["/signups", "Sign-ups"],
  ["/reports", "Reports"],
  ["/app", "App"],
  ["/health", "Health"],
  ["/activity", "Activity"],
  ["/admins", "Admins", true],
];

const FLASH = {
  invited: (q) => [`Invite sent to ${q.n || 0} ${Number(q.n) === 1 ? "person" : "people"}.${Number(q.f) ? ` ${q.f} failed — see Reports › Email health.` : ""}`, Number(q.f) ? "warn" : "ok"],
  resent: (q) => [`Confirmation email sent to ${q.n || 0}.${Number(q.f) ? ` ${q.f} failed.` : ""}`, Number(q.f) ? "warn" : "ok"],
  tagged: (q) => [`Updated tags on ${q.n || 0}.`, "ok"],
  status: (q) => [`Updated ${q.n || 0}.`, "ok"],
  deleted: (q) => [`Deleted ${q.n || 0} permanently.`, "ok"],
  saved: () => ["Saved.", "ok"],
  none: () => ["Select at least one person first.", "warn"],
  confirm: () => ['Type DELETE to confirm deleting.', "err"],
  admin_added: () => ["Admin added. Share the ID and password with them privately.", "ok"],
  admin_updated: () => ["Admin updated.", "ok"],
  admin_error: (q) => [String(q.e || "Couldn't save that admin."), "err"],
  nothing: () => ["Nobody is waiting — there's no one left to invite.", "warn"],
};

function flash(query) {
  const f = FLASH[query.msg];
  if (!f) return "";
  const [text, kind] = f(query);
  return `<div class="alert alert-${kind}" role="status">${esc(text)}</div>`;
}

function layout({ base, admin, active, title, eyebrow, icon = "users", actions = "", meta = "", body, script = "", query = {} }) {
  const tabs = TABS.filter(([, , ownerOnly]) => !ownerOnly || admin.isOwner)
    .map(([href, label]) => `<a class="tab${href === active ? " active" : ""}" href="${esc(base + href)}"${href === active ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("");
  return page(
    title,
    `<header class="global">
  <a href="${esc(base)}" aria-label="NetworQ Admin home"><img src="${LOGO}" alt="NetworQ" /></a>
  <div class="user">
    <span class="who">${esc(admin.username)}${admin.isOwner ? ' <span class="pill pill-brand">Owner</span>' : ""}</span>
    <span class="avatar" aria-hidden="true">${esc(admin.username.slice(0, 2))}</span>
    <form method="post" action="${esc(base)}/logout"><button class="btn btn-plain" type="submit">Log out</button></form>
  </div>
</header>
<nav class="appnav" aria-label="Admin sections">
  <div class="appname"><span class="launcher" aria-hidden="true">${"<i></i>".repeat(9)}</span>Admin</div>
  ${tabs}
</nav>
<main class="wrap">
  ${flash(query)}
  <section class="panel"><div class="panel-body">
    <div class="head">
      <div class="title"><span class="icon-tile">${ICONS[icon] || ICONS.users}</span>
        <div><div class="eyebrow">${esc(eyebrow || "Waitlist")}</div><h1>${esc(title)}</h1>${meta ? `<div class="meta">${meta}</div>` : ""}</div></div>
      ${actions ? `<div class="row">${actions}</div>` : ""}
    </div>
    ${body.top || ""}
  </div></section>
  ${body.rest || ""}
</main>`,
    script
  );
}

const kpi = (label, value, sub = "", cls = "", note = "") =>
  `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-val">${value}${sub ? `<span class="kpi-sub ${cls}">${sub}</span>` : ""}</div>${note ? `<div class="kpi-note ${cls}">${note}</div>` : ""}</div>`;

function bars(items, { total, label = (i) => esc(i.key), empty = "Nothing yet." } = {}) {
  if (!items.length) return `<div class="empty">${esc(empty)}</div>`;
  const max = Math.max(...items.map((i) => i.count), 1);
  return `<div class="list">${items
    .map((i) => {
      const pct = total ? ` · ${Math.round((i.count / total) * 100)}%` : "";
      return `<div class="bar-row"><span class="bar-label">${label(i)}</span><span class="bar-val">${n(i.count)}<span class="muted">${pct}</span></span><span class="bar"><i style="width:${Math.max(3, Math.round((i.count / max) * 100))}%"></i></span></div>`;
    })
    .join("")}</div>`;
}

const card = (title, inner, extra = "") => `<section class="panel"><div class="card-title"><h2>${esc(title)}</h2>${extra}</div>${inner}</section>`;

// Daily sign-ups bar chart — plain HTML/CSS so labels stay readable at every screen size
function chart(series) {
  const max = Math.max(1, ...series.map((d) => d.count));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const label = (day) => new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
  const last = series.length - 1;
  return `<div class="chart" role="img" aria-label="Sign-ups per day, last ${series.length} days">
    <div class="chart-y">${[4, 3, 2, 1, 0].map((i, k) => `<span style="top:${k * 25}%">${i * step}</span>`).join("")}</div>
    <div class="chart-main">
      <div class="chart-bars">${series
        .map((d, i) => `<span class="chart-col" title="${label(d.day)}: ${d.count} sign-up${d.count === 1 ? "" : "s"}"><i style="height:${((d.count / top) * 100).toFixed(1)}%"${i === last ? ' class="today"' : ""}></i></span>`)
        .join("")}</div>
      <div class="chart-x">${series.map((d, i) => `<span>${(last - i) % 7 === 0 ? label(d.day) : ""}</span>`).join("")}</div>
    </div>
  </div>`;
}

const statusPill = (s) => ({ waiting: '<span class="pill pill-warn">Waiting</span>', invited: '<span class="pill pill-info">Invited</span>', joined: '<span class="pill pill-ok">Joined app</span>' })[s || "waiting"];
const emailPill = (r) => (r.notified ? '<span class="pill pill-ok">Sent</span>' : r.email_error ? `<span class="pill pill-err" title="${esc(r.email_error)}">Failed</span>` : '<span class="pill pill-warn">Queued</span>');
const tagsHtml = (tags) => (tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");

// ── Pages ────────────────────────────────────────────────────────────────────

function loginPage(base, error = "") {
  return page(
    "Log in",
    `<main class="login">
  <img src="${LOGO}" alt="NetworQ" />
  <form class="login-card" method="post" action="${esc(base)}/login">
    <div><h1>Log in to NetworQ Admin</h1><p class="fine" style="margin-top:4px">Waitlist, reports and app health</p></div>
    ${error ? `<div class="alert alert-err" role="alert">${esc(error)}</div>` : ""}
    <div class="field"><label for="id">Admin ID</label><input class="big" id="id" name="id" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus /></div>
    <div class="field"><label for="password">Password</label><input class="big" id="password" name="password" type="password" autocomplete="current-password" required /></div>
    <button class="btn btn-brand" type="submit">Log In</button>
  </form>
  <p class="fine" style="margin-top:16px">Authorised NetworQ staff only · © ${new Date().getFullYear()} NetworQ</p>
</main>`
  );
}

function offPage() {
  return page(
    "Admin",
    `<main class="login"><img src="${LOGO}" alt="NetworQ" /><div class="login-card"><h1>Admin is not set up</h1>
  <p class="fine">Add <b>WAITLIST_ADMIN_USER</b> and <b>WAITLIST_ADMIN_PASSWORD</b> in the server's environment settings to turn it on.</p></div></main>`
  );
}

function overviewPage({ base, admin, rows, query, loadError, needsMigration = false, now = Date.now() }) {
  const k = R.kpis(rows, now);
  const series = R.dailySeries(rows, 30, now);
  const growth = k.growth === null ? "" : `${k.growth >= 0 ? "▲" : "▼"} ${Math.abs(k.growth)}% vs the week before`;
  const src = R.sources(rows).slice(0, 6);
  const recent = rows.slice(0, 8);
  const eh = R.emailHealth(rows);
  return layout({
    base, admin, query, active: "", title: "Overview", icon: "chart",
    meta: `${n(k.total)} sign-ups · Updated ${esc(fmtDate(now))} IST`,
    actions: `<a class="btn" href="${esc(base)}">Refresh</a><a class="btn btn-brand" href="${esc(base)}/signups?status=waiting">Invite people</a>`,
    body: {
      top: `${loadError ? `<div class="alert alert-err">${esc(loadError)}</div>` : ""}
      ${needsMigration ? `<div class="alert alert-warn">One database update is still needed for statuses, sources, referrals, tags, extra admins and app numbers: run <b>supabase/migrations/20261020_waitlist_admin.sql</b> in the Supabase SQL editor.</div>` : ""}
      <div class="kpis">
        ${kpi("Total sign-ups", n(k.total))}
        ${kpi("Joined today", n(k.today))}
        ${kpi("Last 7 days", n(k.last7), "", k.growth === null ? "" : k.growth >= 0 ? "up" : "down", growth)}
        ${kpi("Waiting", n(k.waiting))}
        ${kpi("Invited", n(k.invited))}
        ${kpi("Joined the app", n(k.joined), k.total ? `${Math.round((k.joined / k.total) * 100)}%` : "")}
      </div>
      <div><h2 style="margin-bottom:8px">Sign-ups per day · last 30 days</h2>${chart(series)}</div>`,
      rest: `<div class="grid2">
        ${card("Where sign-ups come from", bars(src, { total: rows.length, empty: "No sign-ups yet." }), `<a href="${esc(base)}/reports">All reports</a>`)}
        ${card(
          "Latest sign-ups",
          recent.length
            ? `<div class="list">${recent.map((r) => `<div class="bar-row"><a class="bar-label" href="${esc(base)}/person/${esc(r.id)}">${esc(r.email)}</a><span class="muted">${esc(fmtDate(r.created_at))}</span></div>`).join("")}</div>`
            : `<div class="empty">No sign-ups yet.</div>`,
          `<a href="${esc(base)}/signups">See all</a>`
        )}
      </div>
      ${eh.failed ? `<div class="alert alert-warn">${n(eh.failed)} confirmation email${eh.failed === 1 ? "" : "s"} failed to send. <a href="${esc(base)}/reports#email">Open email health</a></div>` : ""}`,
    },
  });
}

const PAGE_SIZE = 50;

function signupsPage({ base, admin, rows: matched, all, filters, query, loadError }) {
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const pageNo = Math.min(pages, Math.max(1, parseInt(query.page, 10) || 1));
  const rows = matched.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
  const pageHref = (p) => `${base}/signups?${qs({ ...filters, range: filters.range === "all" ? "" : filters.range, page: p > 1 ? p : "" })}`;
  const pager =
    pages > 1
      ? `<div class="row" style="justify-content:space-between"><span class="muted">Showing ${n((pageNo - 1) * PAGE_SIZE + 1)}–${n((pageNo - 1) * PAGE_SIZE + rows.length)} of ${n(matched.length)}</span>
        <span class="row">${pageNo > 1 ? `<a class="btn" href="${esc(pageHref(pageNo - 1))}">‹ Previous</a>` : ""}<span class="muted">Page ${pageNo} of ${pages}</span>${pageNo < pages ? `<a class="btn" href="${esc(pageHref(pageNo + 1))}">Next ›</a>` : ""}</span></div>`
      : "";
  const tags = R.allTags(all);
  const sources = R.sources(all);
  const refs = R.referralCounts(all);
  const exportHref = `${base}/export.csv?${qs(filters)}`;
  const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  const filterForm = `<form class="filters" method="get" action="${esc(base)}/signups">
      <span class="search">${ICONS.search}<input class="control" type="search" name="q" value="${esc(filters.q)}" placeholder="Search email, tag, note…" aria-label="Search" /></span>
      <select class="control" name="range" aria-label="Date range">${Object.entries(R.RANGES).map(([v, l]) => opt(v, l, filters.range)).join("")}${filters.from || filters.to ? opt("", "Custom dates", "") : ""}</select>
      <input class="control" type="date" name="from" value="${esc(filters.from)}" aria-label="From date" />
      <input class="control" type="date" name="to" value="${esc(filters.to)}" aria-label="To date" />
      <select class="control" name="status" aria-label="Status">${opt("", "Any status", filters.status)}${opt("waiting", "Waiting", filters.status)}${opt("invited", "Invited", filters.status)}${opt("joined", "Joined app", filters.status)}</select>
      <select class="control" name="source" aria-label="Source">${opt("", "Any source", filters.source)}${sources.map((s) => opt(s.key, s.key, filters.source)).join("")}</select>
      ${tags.length ? `<select class="control" name="tag" aria-label="Tag">${opt("", "Any tag", filters.tag)}${tags.map((t) => opt(t.key, t.key, filters.tag)).join("")}</select>` : ""}
      <button class="btn btn-brand" type="submit">Apply</button>
      <a class="btn" href="${esc(base)}/signups">Clear</a>
    </form>`;
  const table = rows.length
    ? `<form method="post" action="${esc(base)}/signups/bulk" id="bulk-form">
      <input type="hidden" name="back" value="${esc(qs(filters))}" />
      <div class="bulk" id="bulk" hidden>
        <b><span id="sel-count">0</span> selected</b>
        <select class="control" name="action" id="bulk-action" aria-label="Action">
          <option value="invite">Send invite</option>
          <option value="resend">Resend confirmation email</option>
          <option value="tag_add">Add tag…</option>
          <option value="tag_remove">Remove tag…</option>
          <option value="status_waiting">Mark as waiting</option>
          <option value="delete">Delete permanently…</option>
        </select>
        <input class="control" name="tag" id="bulk-tag" placeholder="Tag name" maxlength="40" hidden aria-label="Tag name" />
        <input type="hidden" name="confirm" id="bulk-confirm" />
        <button class="btn btn-brand" type="submit">Apply</button>
      </div>
      <div class="table-wrap" style="margin-top:12px"><table id="t">
        <thead><tr>
          <th class="check"><input type="checkbox" id="all" aria-label="Select all" /></th>
          <th>Email</th><th>Status</th><th>Queue #</th><th>Referrals</th><th>Joined (IST)</th><th>Source</th><th>Tags</th><th>Confirmation</th>
        </tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr>
          <td class="check"><input type="checkbox" name="ids" value="${esc(r.id)}" aria-label="Select ${esc(r.email)}" /></td>
          <td><a href="${esc(base)}/person/${esc(r.id)}">${esc(r.email)}</a></td>
          <td>${statusPill(r.status)}</td>
          <td>${esc(r.position ?? "—")}</td>
          <td>${n(refs.get(r.ref_code) || 0)}</td>
          <td>${esc(fmtDate(r.created_at))}</td>
          <td class="muted">${esc(R.sourceOf(r))}</td>
          <td>${tagsHtml(r.tags)}</td>
          <td>${emailPill(r)}</td>
        </tr>`
          )
          .join("")}</tbody>
      </table></div>
    </form>`
    : `<div class="empty">No sign-ups match these filters.</div>`;
  const waiting = all.filter((r) => (r.status || "waiting") === "waiting").length;
  const inviteNext = `<form class="row" method="post" action="${esc(base)}/invite-next">
      <label for="n" class="muted">Invite the next</label>
      <input class="control" id="n" name="n" type="number" min="1" max="50" value="10" style="width:80px" />
      <span class="muted">people (most referrals first, then earliest) · ${n(waiting)} waiting</span>
      <button class="btn btn-brand" type="submit">Send invites</button>
    </form>`;
  const script = `<script>
(function () {
  var form = document.getElementById('bulk-form'); if (!form) return;
  var boxes = Array.prototype.slice.call(form.querySelectorAll('input[name=ids]'));
  var all = document.getElementById('all'), bar = document.getElementById('bulk'), count = document.getElementById('sel-count');
  var action = document.getElementById('bulk-action'), tag = document.getElementById('bulk-tag'), confirmEl = document.getElementById('bulk-confirm');
  function update() { var c = boxes.filter(function (b) { return b.checked; }).length; count.textContent = c; bar.hidden = c === 0; all.checked = c === boxes.length && c > 0; }
  boxes.forEach(function (b) { b.addEventListener('change', update); });
  all.addEventListener('change', function () { boxes.forEach(function (b) { b.checked = all.checked; }); update(); });
  action.addEventListener('change', function () { tag.hidden = action.value.indexOf('tag_') !== 0; tag.required = !tag.hidden; });
  form.addEventListener('submit', function (e) {
    if (action.value === 'delete') {
      var v = window.prompt('This permanently deletes the selected people from the waitlist. Type DELETE to confirm.');
      if (v !== 'DELETE') { e.preventDefault(); return; }
      confirmEl.value = 'DELETE';
    } else if (action.value === 'invite' && !window.confirm('Send the invite email to the selected people?')) { e.preventDefault(); }
  });
})();
</script>`;
  return layout({
    base, admin, query, active: "/signups", title: "All Sign-ups", icon: "users",
    meta: `${n(matched.length)} of ${n(all.length)} match`,
    actions: `<a class="btn" href="${esc(exportHref)}">Export CSV</a>`,
    body: { top: `${loadError ? `<div class="alert alert-err">${esc(loadError)}</div>` : ""}${filterForm}${inviteNext}${table}${pager}` },
    script,
  });
}

function personPage({ base, admin, r, all, query }) {
  const refs = R.referralCounts(all);
  const referrer = r.referred_by ? all.find((x) => x.ref_code === r.referred_by) : null;
  const brought = all.filter((x) => x.referred_by && x.referred_by === r.ref_code);
  const d = (label, val) => `<div class="detail"><div class="detail-label">${esc(label)}</div><div class="detail-val">${val}</div></div>`;
  const shareLink = r.ref_code ? `https://waitlist.networq.co.in/?ref=${encodeURIComponent(r.ref_code)}` : "";
  return layout({
    base, admin, query, active: "/signups", title: r.email, eyebrow: "Sign-up", icon: "person",
    meta: `Queue #${esc(r.position ?? "—")} · Signed up ${esc(fmtDate(r.created_at))} IST`,
    actions: `<form method="post" action="${esc(base)}/person/${esc(r.id)}/action" class="row">
        <button class="btn btn-brand" name="action" value="invite" type="submit">${r.status === "invited" ? "Send invite again" : "Send invite"}</button>
        <button class="btn" name="action" value="resend" type="submit">Resend confirmation</button>
      </form>`,
    body: {
      top: `<div class="details">
        ${d("Status", statusPill(r.status))}
        ${d("Confirmation email", emailPill(r) + (r.email_error ? `<div class="muted" style="margin-top:4px">${esc(r.email_error)}</div>` : ""))}
        ${d("Invited", esc(fmtDate(r.invited_at)))}
        ${d("Joined the app", esc(fmtDate(r.joined_at)))}
        ${d("Source", esc(R.sourceOf(r)))}
        ${d("Signed up on", esc({ landing: "waitlist.networq.co.in (full page)", "waitlist-page": "networq.co.in/waitlist" }[r.source] || r.source || "—"))}
        ${d("Campaign", esc([r.utm_campaign, r.utm_medium].filter(Boolean).join(" · ") || "—"))}
        ${d("Came from page", r.referrer ? esc(r.referrer) : "—")}
        ${d("Device", esc(r.device || "—"))}
        ${d("Time zone", esc(r.timezone || "—"))}
        ${d("Referred by", referrer ? `<a href="${esc(base)}/person/${esc(referrer.id)}">${esc(referrer.email)}</a>` : "—")}
        ${d("People they brought", `${n(refs.get(r.ref_code) || 0)}${brought.length ? ` · ${brought.slice(0, 5).map((b) => `<a href="${esc(base)}/person/${esc(b.id)}">${esc(b.email)}</a>`).join(", ")}` : ""}`)}
        ${d("Their invite link", shareLink ? esc(shareLink) : "—")}
      </div>`,
      rest: `<div class="grid2">
        ${card(
          "Notes & tags",
          `<form class="list" method="post" action="${esc(base)}/person/${esc(r.id)}">
            <div class="field"><label for="tags">Tags (comma separated)</label><input id="tags" name="tags" value="${esc((r.tags || []).join(", "))}" maxlength="300" placeholder="investor, college, vip" /></div>
            <div class="field"><label for="notes">Notes</label><textarea id="notes" name="notes" maxlength="4000">${esc(r.notes || "")}</textarea></div>
            <div><button class="btn btn-brand" type="submit">Save</button></div>
          </form>`
        )}
        ${card(
          "Delete",
          `<form class="list" method="post" action="${esc(base)}/person/${esc(r.id)}/action">
            <p class="muted">Removes this person from the waitlist permanently (for example, when they ask to be removed). This can't be undone.</p>
            <div class="field"><label for="confirm">Type DELETE to confirm</label><input id="confirm" name="confirm" autocomplete="off" /></div>
            <div><button class="btn btn-danger" name="action" value="delete" type="submit">Delete permanently</button></div>
          </form>`
        )}
      </div>`,
    },
  });
}

function reportsPage({ base, admin, rows, filters, query }) {
  const dom = R.domains(rows);
  const refs = R.referrals(rows);
  const eh = R.emailHealth(rows);
  const opt = (v, label) => `<option value="${esc(v)}"${v === filters.range ? " selected" : ""}>${esc(label)}</option>`;
  return layout({
    base, admin, query, active: "/reports", title: "Reports", icon: "chart",
    meta: `${n(rows.length)} sign-ups in ${esc((R.RANGES[filters.range] || "the selected dates").toLowerCase())}`,
    actions: `<form class="row" method="get" action="${esc(base)}/reports"><select class="control" name="range" aria-label="Date range" onchange="this.form.submit()">${Object.entries(R.RANGES).map(([v, l]) => opt(v, l)).join("")}</select><noscript><button class="btn" type="submit">Apply</button></noscript></form>
      <a class="btn" href="${esc(base)}/export.csv?${esc(qs({ range: filters.range }))}">Export CSV</a>`,
    body: {
      top: `<div class="kpis">
        ${kpi("Sign-ups", n(rows.length))}
        ${kpi("From company emails", n(dom.companyCount), rows.length ? `${Math.round((dom.companyCount / rows.length) * 100)}%` : "")}
        ${kpi("Came through a referral", n(refs.referred), rows.length ? `${Math.round((refs.referred / rows.length) * 100)}%` : "")}
        ${kpi("Confirmation emails sent", n(eh.sent))}
      </div>`,
      rest: `<div class="grid2">
        ${card("Sources", bars(R.sources(rows), { total: rows.length, empty: "No sign-ups in this period." }))}
        ${card("Campaigns (utm_campaign)", bars(R.campaigns(rows), { total: rows.length, empty: "No campaign links used yet. Add ?utm_source=instagram&utm_campaign=launch to links you share." }))}
        ${card("Companies (work email domains)", bars(dom.companies, { total: rows.length, empty: "No company email addresses yet." }))}
        ${card("All email domains", bars(dom.top, { total: rows.length, label: (i) => `${esc(i.key)} <span class="tag">${i.kind}</span>`, empty: "No sign-ups yet." }))}
        ${card("Top referrers", bars(refs.top.map((t) => ({ key: t.email, count: t.count, id: t.id })), { label: (i) => `<a href="${esc(base)}/person/${esc(i.id)}">${esc(i.key)}</a>`, empty: "No referrals yet. Everyone gets a share link after signing up." }))}
        ${card("Devices", bars(R.devices(rows), { total: rows.length, empty: "No sign-ups yet." }))}
        ${card("Time zones (approximate location)", bars(R.timezones(rows), { total: rows.length, empty: "No sign-ups yet." }))}
        <section class="panel" id="email"><div class="card-title"><h2>Email health</h2>${
          eh.failed ? `<form method="post" action="${esc(base)}/retry-failed"><button class="btn" type="submit">Retry failed</button></form>` : ""
        }</div>
          <div class="list">
            <div class="bar-row"><span>Sent</span><span class="bar-val">${n(eh.sent)}</span></div>
            <div class="bar-row"><span>Queued</span><span class="bar-val">${n(eh.queued)}</span></div>
            <div class="bar-row"><span>Failed</span><span class="bar-val">${n(eh.failed)}</span></div>
            ${eh.failedRows.map((r) => `<div class="bar-row"><a class="bar-label" href="${esc(base)}/person/${esc(r.id)}">${esc(r.email)}</a><span class="muted bar-label" style="max-width:220px">${esc(r.email_error)}</span></div>`).join("")}
          </div>
        </section>
      </div>`,
    },
  });
}

const AI_LABELS = { card_scan: "Business cards scanned", email_generation: "Follow-up emails written by AI", email_send: "Emails sent from the app", prospect_research: "Prospect research runs", transcribe: "Voice notes transcribed" };

function appPage({ base, admin, stats, error, query }) {
  const s = stats || {};
  const ai = Object.entries(s.ai_30d || {}).map(([k, v]) => ({ key: AI_LABELS[k] || k, count: Number(v) })).sort((a, b) => b.count - a.count);
  return layout({
    base, admin, query, active: "/app", title: "App usage", eyebrow: "NetworQ app", icon: "app",
    meta: "Live from the database",
    body: {
      top: error
        ? `<div class="alert alert-err">Couldn't load app numbers: ${esc(error)}</div>`
        : `<div class="kpis">
        ${kpi("App users", n(s.users_total))}
        ${kpi("New users · 7 days", n(s.users_new_7d))}
        ${kpi("Active · 7 days", n(s.active_7d))}
        ${kpi("Active · 30 days", n(s.active_30d))}
      </div>
      <p class="fine">"Active" means the person did something in the app — added a contact, sent a message, made a call, used AI or checked in at an event.</p>`,
      rest: error
        ? ""
        : `<div class="grid2">
        ${card("Contacts & conversations", `<div class="list">
          <div class="bar-row"><span>Contacts saved (all time)</span><span class="bar-val">${n(s.contacts_total)}</span></div>
          <div class="bar-row"><span>Contacts added · 7 days</span><span class="bar-val">${n(s.contacts_7d)}</span></div>
          <div class="bar-row"><span>Chat messages · 7 days</span><span class="bar-val">${n(s.messages_7d)}</span></div>
          <div class="bar-row"><span>Calls · 7 days</span><span class="bar-val">${n(s.calls_7d)} <span class="muted">(${n(s.calls_answered_7d)} answered)</span></span></div>
          <div class="bar-row"><span>Group calls · 7 days</span><span class="bar-val">${n(s.group_calls_7d)}</span></div>
        </div>`)}
        ${card("Events & Radar", `<div class="list">
          <div class="bar-row"><span>Events in NetworQ (all time)</span><span class="bar-val">${n(s.events_total)}</span></div>
          <div class="bar-row"><span>Events created by users · 30 days</span><span class="bar-val">${n(s.events_user_30d)}</span></div>
          <div class="bar-row"><span>Event check-ins · 30 days</span><span class="bar-val">${n(s.event_checkins_30d)}</span></div>
          <div class="bar-row"><span>Upcoming listed events</span><span class="bar-val">${n(s.public_events_upcoming)}</span></div>
        </div>`)}
        ${card("AI features · 30 days", bars(ai, { empty: "No AI use in the last 30 days." }))}
      </div>`,
    },
  });
}

function fmtDuration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} days`;
}

function healthPage({ base, admin, health, provider, rows, query }) {
  const eh = R.emailHealth(rows);
  const providerWarn =
    provider.name === "none"
      ? "No email service is set up, so emails are not being sent. Add RESEND_API_KEY (and RESEND_FROM_EMAIL) on Render."
      : provider.name === "resend" && /@resend\.dev$/i.test(provider.from)
        ? `Emails are sent from ${provider.from}, which Resend only delivers to your own Resend account. Set RESEND_FROM_EMAIL to an address on networq.co.in (verified in Resend).`
        : "";
  const errRows = health.recentErrors.length
    ? `<div class="table-wrap"><table><thead><tr><th>When (IST)</th><th>Request</th><th>Status</th></tr></thead><tbody>${health.recentErrors
        .map((e) => `<tr><td>${esc(fmtDate(e.at))}</td><td>${esc(e.method)} ${esc(e.path)}</td><td><span class="pill pill-err">${e.status}</span></td></tr>`)
        .join("")}</tbody></table></div>`
    : `<div class="empty">No server errors since the last restart.</div>`;
  return layout({
    base, admin, query, active: "/health", title: "Health", eyebrow: "Server & email", icon: "pulse",
    meta: `Server started ${esc(fmtDate(health.startedAt))} IST · up ${esc(fmtDuration(health.uptimeMs))} · counts reset when the server restarts`,
    actions: `<a class="btn" href="${esc(base)}/health">Refresh</a>`,
    body: {
      top: `${providerWarn ? `<div class="alert alert-warn">${esc(providerWarn)}</div>` : ""}
      <div class="kpis">
        ${kpi("Requests served", n(health.requests))}
        ${kpi("Server errors (5xx)", n(health.serverErrors), health.requests ? `${((health.serverErrors / health.requests) * 100).toFixed(2)}%` : "", health.serverErrors ? "down" : "")}
        ${kpi("Emails sent", n(health.emailsSent))}
        ${kpi("Email failures", n(health.emailFailures), "", health.emailFailures ? "down" : "")}
        ${kpi("Memory", `${n(health.memoryMb)} MB`)}
      </div>
      <div class="details">
        <div class="detail"><div class="detail-label">Email service</div><div class="detail-val">${esc(provider.name === "none" ? "Not set up" : provider.name)}</div></div>
        <div class="detail"><div class="detail-label">Sends from</div><div class="detail-val">${esc(provider.from || "—")}</div></div>
        <div class="detail"><div class="detail-label">Waitlist emails failed</div><div class="detail-val">${n(eh.failed)} <a href="${esc(base)}/reports#email">details</a></div></div>
        <div class="detail"><div class="detail-label">Node.js</div><div class="detail-val">${esc(health.node)}</div></div>
      </div>`,
      rest: `${card("Recent server errors", `<div class="list">${errRows}</div>`)}
      ${card(
        "Recent email failures",
        health.recentEmailFailures.length
          ? `<div class="list">${health.recentEmailFailures.map((f) => `<div class="bar-row"><span class="bar-label">${esc(f.subject)} — ${esc(f.error)}</span><span class="muted">${esc(fmtDate(f.at))}</span></div>`).join("")}</div>`
          : `<div class="empty">No email failures since the last restart.</div>`
      )}`,
    },
  });
}

const ACTION_LABELS = {
  login: "Logged in", login_failed: "Failed login", logout: "Logged out", invite: "Sent invite", resend: "Resent confirmation",
  tag_add: "Added tag", tag_remove: "Removed tag", status_waiting: "Marked as waiting", delete: "Deleted sign-up", notes: "Edited notes & tags",
  export: "Exported CSV", admin_add: "Added admin", admin_disable: "Disabled admin", admin_enable: "Enabled admin", retry_failed: "Retried failed emails", invite_next: "Invited next in queue",
};

function activityPage({ base, admin, entries, query }) {
  return layout({
    base, admin, query, active: "/activity", title: "Activity log", eyebrow: "Who did what", icon: "list",
    meta: `Latest ${n(entries.length)} actions`,
    body: {
      top: entries.length
        ? `<div class="table-wrap"><table><thead><tr><th>When (IST)</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead><tbody>${entries
            .map(
              (e) => `<tr><td>${esc(fmtDate(e.created_at))}</td><td>${esc(e.admin)}</td><td>${esc(ACTION_LABELS[e.action] || e.action)}</td><td class="muted">${esc(
                [e.target, e.details ? Object.entries(e.details).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length + " people" : v}`).join(", ") : ""].filter(Boolean).join(" · ")
              )}</td></tr>`
            )
            .join("")}</tbody></table></div>`
        : `<div class="empty">Nothing yet. Logins, invites, edits and exports will show here.</div>`,
    },
  });
}

function adminsPage({ base, admin, owner, admins, query }) {
  return layout({
    base, admin, query, active: "/admins", title: "Admins", eyebrow: "Access", icon: "shield",
    meta: `${n(admins.filter((a) => !a.disabled_at).length + 1)} people can log in`,
    body: {
      top: `<div class="table-wrap"><table><thead><tr><th>Admin ID</th><th>Role</th><th>Added</th><th>Last login</th><th>Status</th><th></th></tr></thead><tbody>
        <tr><td><b>${esc(owner)}</b></td><td>Owner</td><td class="muted">Render setting</td><td class="muted">—</td><td><span class="pill pill-ok">Active</span></td><td class="muted">Change on Render</td></tr>
        ${admins
          .map(
            (a) => `<tr><td><b>${esc(a.username)}</b></td><td>Admin</td><td>${esc(fmtDate(a.created_at, false))}</td><td>${esc(fmtDate(a.last_login_at))}</td>
          <td>${a.disabled_at ? '<span class="pill pill-err">Disabled</span>' : '<span class="pill pill-ok">Active</span>'}</td>
          <td><form method="post" action="${esc(base)}/admins/${esc(a.id)}"><button class="btn${a.disabled_at ? "" : " btn-danger"}" name="action" value="${a.disabled_at ? "enable" : "disable"}" type="submit">${a.disabled_at ? "Enable" : "Disable"}</button></form></td></tr>`
          )
          .join("")}
      </tbody></table></div>`,
      rest: card(
        "Add an admin",
        `<form class="list" method="post" action="${esc(base)}/admins" autocomplete="off">
          <div class="grid2" style="gap:12px">
            <div class="field"><label for="u">Admin ID</label><input id="u" name="username" required pattern="[a-z0-9._-]{3,40}" placeholder="e.g. priya" autocapitalize="none" spellcheck="false" /></div>
            <div class="field"><label for="p">Password (at least 10 characters)</label><input id="p" name="password" type="password" required minlength="10" autocomplete="new-password" /></div>
          </div>
          <p class="fine">Admins can see and manage the waitlist and reports. Only the owner can add or disable admins.</p>
          <div><button class="btn btn-brand" type="submit">Add admin</button></div>
        </form>`
      ),
    },
  });
}

module.exports = { esc, loginPage, offPage, overviewPage, signupsPage, personPage, reportsPage, appPage, healthPage, activityPage, adminsPage };
