// AI prospect research + intelligent email drafting.
//
// Research first, write second:
//   contact → domain resolution → public website research (robots.txt honoured,
//   SSRF-guarded) → sourced fact extraction → evidence check (every "verified" fact
//   must quote its source verbatim) → saved brief
//   brief + our organisation + manual context + value prospect → drafts A/B/C →
//   fact validation (rule checks + an independent AI check) → rewrite of flagged drafts
//
// Sending stays with the user: the client sends through /api/email only after explicit
// approval and records the activity in follow_up_emails.
//
// Social networks (LinkedIn, Instagram, Facebook, X, YouTube) need sign-in and forbid
// automated reading, so only the profile links published on the company's own site are
// recorded — their contents are never fetched or guessed.

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { verifyAndCheckLimit } = require("./_lib/verifyAndLimit");
const { TEXT_MODEL, FALLBACK_MODEL } = require("./_lib/groq");
const { fetchHtml } = require("./enrich");
const { parseRobots, robotsAllows, USER_AGENT } = require("./eventsCrawler");

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "zoho.com", "rediffmail.com", "gmx.com", "yandex.com", "mail.com",
]);
const SOCIAL_HOSTS = { linkedin: /linkedin\.com\/(company|in|school)\//i, instagram: /instagram\.com\//i, facebook: /facebook\.com\//i, x: /(twitter|x)\.com\//i, youtube: /youtube\.com\//i };
const PAGE_KINDS = [
  { kind: "about", re: /about|who-we-are|our-story|company|team/i },
  { kind: "services", re: /services?|solutions?|what-we-do|offerings?|capabilit/i },
  { kind: "products", re: /products?|platform|features|pricing/i },
  { kind: "industries", re: /industr|sectors?|who-we-serve/i },
  { kind: "case_studies", re: /case-stud|customers?|clients?|portfolio|our-work|success/i },
  { kind: "news", re: /blog|news|press|insights|updates/i },
  { kind: "careers", re: /careers?|jobs|join-us|hiring/i },
];
const MAX_PAGES = 6;
const SOURCE_CHARS = 2600;

const VALUE_OPTIONS = ["Lead generation", "Digital marketing", "Website development", "CRM implementation", "Performance marketing", "Automation", "Video production", "Branding", "Software development", "Consulting", "Partnership", "Distribution", "Recruitment"];
const TONES = ["Professional", "Friendly", "Conversational", "Executive", "Direct", "Partnership-focused"];
const EMAIL_TYPES = ["Networking follow-up", "Sales outreach", "Partnership", "Introduction", "Collaboration", "Meeting follow-up", "Follow-up", "Custom"];
const REFINEMENTS = {
  shorter: "Make it shorter (aim for 80–120 words) without losing the reason for reaching out.",
  natural: "Make it sound more natural and human, like a real person typed it.",
  professional: "Make it more professional and polished.",
  warmer: "Make it warmer and friendlier.",
  direct: "Make it more direct; get to the point in the first sentence.",
  cta: "Improve the call to action: one clear, low-friction question.",
  less_sales: "Reduce sales language; no hype, no pressure, no superlatives.",
  more_context: "Add a little more context about why this is relevant, using only the allowed facts.",
  less_personal: "Remove any personalization that isn't clearly useful to the reader.",
  regenerate: "Write a fresh alternative with a different angle and different wording.",
};
// Superficial personalization the brief forbids unless genuinely sourced
const GENERIC_PHRASES = [
  /i noticed (that )?your company is growing/i, /i love what (you|your company) (are|is) doing/i, /as a leader in (your|the) industry/i,
  /(a|the) leading (company|provider|player)/i, /i hope this (email|message) finds you well/i, /i came across your (company|profile)/i,
  /industry leader/i, /world-class/i, /cutting-edge/i, /synerg/i,
];

// ── Text helpers ──────────────────────────────────────────────────────────────
const decode = (s) =>
  String(s || "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const norm = (s) => decode(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s\S*$/, "") + " …" : s);
const str = (v, n = 400) => (typeof v === "string" ? v.trim().slice(0, n) : "");

function resolveDomain(contact) {
  const fromUrl = (u) => {
    try {
      return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return null;
    }
  };
  if (contact.domain) return fromUrl(contact.domain);
  if (contact.website) return fromUrl(contact.website);
  const emailDomain = String(contact.email || "").split("@")[1]?.toLowerCase().trim();
  if (emailDomain && !FREE_MAIL.has(emailDomain) && /\./.test(emailDomain)) return emailDomain;
  return null;
}

// Pull readable text, metadata, JSON-LD organisation data, social links and internal links
function extractPage(html, url) {
  const base = new URL(url);
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/\s+/g, " ").trim();
  const metaDesc = decode(
    (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i) || [])[1] || ""
  ).trim();

  const org = {};
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const nodes = [].concat(data["@graph"] || data);
      for (const n of nodes) {
        const t = [].concat(n?.["@type"] || []).join(" ");
        if (/Organization|Corporation|LocalBusiness/i.test(t)) {
          if (n.name && !org.name) org.name = str(n.name, 120);
          if (n.description && !org.description) org.description = str(n.description, 600);
          if (n.sameAs) org.sameAs = [].concat(n.sameAs).filter((x) => typeof x === "string").slice(0, 10);
          const a = n.address;
          if (a && !org.location) org.location = typeof a === "string" ? str(a, 160) : [a.addressLocality, a.addressRegion, a.addressCountry?.name || a.addressCountry].filter((x) => typeof x === "string").join(", ");
        }
      }
    } catch {}
  }

  const socials = {};
  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href;
    try {
      href = new URL(decode(m[1]), base);
    } catch {
      continue;
    }
    for (const [k, re] of Object.entries(SOCIAL_HOSTS)) if (!socials[k] && re.test(href.href)) socials[k] = href.href.split("?")[0];
    const sameSite = href.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
    if (sameSite && /^https?:$/.test(href.protocol) && !/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4)$/i.test(href.pathname)) {
      links.push({ url: href.origin + href.pathname, text: decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 80) });
    }
  }
  for (const s of org.sameAs || []) for (const [k, re] of Object.entries(SOCIAL_HOSTS)) if (!socials[k] && re.test(s)) socials[k] = s;

  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

  return { title, metaDesc, org, socials, links, text };
}

// Choose the most useful internal pages: one per kind (about, services, …)
function pickPages(links, homeUrl) {
  const home = new URL(homeUrl).pathname.replace(/\/$/, "");
  const chosen = [];
  const seen = new Set([home]);
  for (const { kind, re } of PAGE_KINDS) {
    const hit = links.find((l) => {
      const path = new URL(l.url).pathname.replace(/\/$/, "");
      return !seen.has(path) && path.split("/").length <= 3 && (re.test(path) || re.test(l.text));
    });
    if (hit) {
      seen.add(new URL(hit.url).pathname.replace(/\/$/, ""));
      chosen.push({ kind, url: hit.url });
    }
    if (chosen.length >= MAX_PAGES - 1) break;
  }
  return chosen;
}

// Fetch the company's homepage and key pages, honouring robots.txt
async function gatherWebsite(domain, fetchPage) {
  const limitations = [];
  const sources = [];
  let home = null;
  let homeUrl = null;
  for (const candidate of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      home = await fetchPage(candidate);
      homeUrl = candidate;
      break;
    } catch (err) {
      if (err.code === "ROBOTS") {
        limitations.push(`${domain} asks automated tools not to read its pages (robots.txt), so the website wasn't researched.`);
        return { sources, socials: {}, org: {}, limitations };
      }
    }
  }
  if (!home) {
    limitations.push(`Couldn't reach ${domain}, so no website research was possible.`);
    return { sources, socials: {}, org: {}, limitations };
  }
  const page = extractPage(home, homeUrl);
  const homeText = [page.metaDesc, page.org.description, page.text].filter(Boolean).join("\n");
  sources.push({ id: "S1", kind: "homepage", url: homeUrl, title: page.title || domain, text: clip(homeText, SOURCE_CHARS) });

  const picks = pickPages(page.links, homeUrl);
  const pages = await Promise.all(
    picks.map(async (p) => {
      try {
        const html = await fetchPage(p.url);
        const ex = extractPage(html, p.url);
        return { ...p, title: ex.title || p.kind, text: clip([ex.metaDesc, ex.text].filter(Boolean).join("\n"), SOURCE_CHARS), socials: ex.socials };
      } catch {
        return null;
      }
    })
  );
  const socials = { ...page.socials };
  for (const p of pages.filter(Boolean)) {
    if (p.text.length < 80) continue;
    sources.push({ id: `S${sources.length + 1}`, kind: p.kind, url: p.url, title: p.title, text: p.text });
    for (const [k, v] of Object.entries(p.socials || {})) if (!socials[k]) socials[k] = v;
  }
  if (Object.keys(socials).length) {
    limitations.push(`Social profiles (${Object.keys(socials).join(", ")}) were found on the website, but their contents need sign-in and can't be read automatically — only the links are recorded.`);
  }
  return { sources, socials, org: page.org, limitations };
}

// ── AI helpers ────────────────────────────────────────────────────────────────
function parseJson(text) {
  const cleaned = String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The AI returned an unreadable answer.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const sourceBlock = (sources) => sources.map((s) => `[${s.id}] ${s.kind.toUpperCase()} — ${s.title} (${s.url})\n${s.text}`).join("\n\n---\n\n");

const EXTRACT_SYSTEM = `You are a meticulous B2B research analyst. You read public web pages about a company and build a factual prospect brief.
Rules:
- Use ONLY the numbered sources provided. Never use outside knowledge about the company.
- Every fact must cite exactly one source id and include "evidence": a short VERBATIM quote (5–25 words) copied character-for-character from that source.
- If something isn't stated in the sources, leave it out. Do not guess revenue, funding, clients, awards, headcount, growth, technology or problems.
- "potential_needs" are hypotheses: phrase them as possibilities ("may want…"), with status "inferred" and the source ids they are based on.
- Keep facts specific and useful for a business conversation; skip boilerplate (cookie notices, copyright, navigation).
- Professional context only: no personal or sensitive information about individuals.
Return JSON only.`;

function extractPrompt(contact, sources) {
  return `PROSPECT (from the user's CRM, confirmed by the user):
${JSON.stringify({ name: contact.name, title: contact.title, company: contact.company, email_domain: String(contact.email || "").split("@")[1] || null, website: contact.website, location: contact.location })}

SOURCES:
${sourceBlock(sources)}

Return JSON with this exact shape:
{
  "company": {
    "name": string|null,
    "industry": fact|null,
    "offerings": [fact],          // products / services
    "audience": [fact],           // who they sell to
    "business_model": fact|null,
    "initiatives": [fact],        // current launches, programmes, hiring, news
    "positioning": [fact],        // how they describe themselves
    "locations": [fact]
  },
  "person": { "role_context": [fact] },   // only facts about the prospect's role/team stated in the sources
  "signals": [fact],             // 1–4 specific, verifiable things that make outreach relevant
  "potential_needs": [{ "text": string, "status": "inferred", "based_on": [source ids] }]
}
where fact = { "text": string, "source": "S#", "evidence": "verbatim quote" }`;
}

// A fact is verified only when its quote really appears in the cited source
function validateBrief(raw, sources) {
  const byId = new Map(sources.map((s) => [s.id, norm(s.text + " " + s.title)]));
  const check = (f) => {
    if (!f || typeof f !== "object" || !str(f.text)) return null;
    const src = byId.get(f.source);
    const ev = norm(f.evidence || "");
    const ok = !!src && ev.split(" ").length >= 3 && src.includes(ev);
    return { text: str(f.text, 300), source: src ? f.source : null, evidence: str(f.evidence, 300), status: ok ? "verified" : "unverified" };
  };
  const list = (a) => (Array.isArray(a) ? a.map(check).filter(Boolean).slice(0, 8) : []);
  const c = raw?.company || {};
  return {
    company: {
      name: str(c.name, 160) || null,
      industry: check(c.industry),
      offerings: list(c.offerings),
      audience: list(c.audience),
      business_model: check(c.business_model),
      initiatives: list(c.initiatives),
      positioning: list(c.positioning),
      locations: list(c.locations),
    },
    person: { role_context: list(raw?.person?.role_context) },
    signals: list(raw?.signals),
    potential_needs: (Array.isArray(raw?.potential_needs) ? raw.potential_needs : [])
      .filter((n) => str(n?.text))
      .slice(0, 4)
      .map((n) => ({ text: str(n.text, 300), status: "inferred", based_on: (Array.isArray(n.based_on) ? n.based_on : []).filter((id) => byId.has(id)) })),
  };
}

// Flatten the brief into the fact sheet the writer may use
function factSheet(brief) {
  const out = { verified: [], inferred: [] };
  const push = (f, label) => f && f.status === "verified" && out.verified.push({ text: `${label}: ${f.text}`, source: f.source });
  const c = brief.company || {};
  push(c.industry, "Industry");
  push(c.business_model, "Business model");
  for (const [k, label] of [["offerings", "Offering"], ["audience", "Audience"], ["initiatives", "Initiative"], ["positioning", "Positioning"], ["locations", "Location"]]) for (const f of c[k] || []) push(f, label);
  for (const f of brief.person?.role_context || []) push(f, "Role");
  for (const f of brief.signals || []) push(f, "Signal");
  for (const n of brief.potential_needs || []) out.inferred.push({ text: n.text, based_on: n.based_on });
  return out;
}

const DRAFT_SYSTEM = `You write short, genuinely personal B2B emails for a professional who will review and send them under their own name.
Hard rules:
- Use ONLY the facts provided. A statement about the prospect or their company must come from VERIFIED facts (cite the id) or USER-PROVIDED context. Never invent partnerships, clients, revenue, funding, launches, growth, job openings, awards, locations, technology, problems or achievements.
- INFERRED needs are hypotheses: you may only phrase them as a question or possibility ("if improving X is on your list…"), never as fact.
- Facts about the sender's organisation must come from the ORGANISATION profile.
- Pick only the 1–2 facts that make the message more relevant. Do not summarise the website. Do not stuff research in.
- No generic flattery or filler: never "I hope this finds you well", "I love what you're doing", "as a leader in your industry", "I noticed your company is growing", "world-class", "cutting-edge".
- Structure: natural opening with the real reason for writing → brief context → what we could help with → why it fits them specifically → ONE low-friction call to action (a single question) → the provided signature verbatim.
- Length: 100–180 words for the body before the signature, unless told otherwise.
- Never claim or imply the prospect replied or agreed to anything unless the history says so.
- Subject lines follow the same fact rules as the body.
- Plain text, no markdown, no placeholders like [Name], and never write source ids like (S2) in the email.
Return JSON only.`;

const OPTION_BRIEFS = {
  A: "OPTION A — Contextual / Human: built mainly on the MANUAL CONTEXT and how they met (event, conversation). Reads like a person following up after meeting someone. Light on research.",
  B: "OPTION B — Research-driven: built on one specific VERIFIED signal from their company plus the prospect's role, connected to our relevant capability. Shows we understand their business.",
  C: "OPTION C — Value / opportunity: concise and commercially clear: their likely need (as a hypothesis), our specific capability, one simple next step. Not aggressive.",
};

function draftPrompt({ contact, research, facts, org, sender, input, history, options, refine }) {
  const verified = facts.verified.map((f) => `- [${f.source}] ${f.text}`).join("\n") || "(none — the website could not be researched)";
  const inferred = facts.inferred.map((f) => `- ${f.text}`).join("\n") || "(none)";
  const crm = [contact.title && `Title: ${contact.title}`, contact.company && `Company: ${contact.company}`, contact.event && `Met at: ${contact.event}`, contact.location && `Location: ${contact.location}`].filter(Boolean).join("\n");
  const hist = history.length
    ? history.map((h, i) => `#${i + 1} sent ${String(h.sent_at || h.created_at).slice(0, 10)} — reply status: ${h.reply_status || "none"}\nSubject: ${h.subject || "(none)"}\n${clip(String(h.body || h.draft || ""), 700)}`).join("\n\n")
    : "(no previous emails)";
  const step = input.emailType === "Follow-up" ? history.filter((h) => h.sent).length : 0;
  const stepGuide = ["", "This is FOLLOW-UP 1: briefly reference the previous email; add one new reason to talk.", "This is FOLLOW-UP 2: lead with something useful for them (an idea or relevant capability); no guilt-tripping.", "This is FOLLOW-UP 3: politely close the loop; make it easy to say 'not now'."][Math.min(step, 3)] || "This is a late follow-up: keep it very short and courteous.";

  return `PROSPECT: ${contact.name}${contact.title ? `, ${contact.title}` : ""}${contact.company ? ` at ${contact.company}` : ""}
CRM (USER-PROVIDED):
${crm || "(nothing beyond name)"}

MANUAL CONTEXT (USER-PROVIDED, highest priority):
${input.manualContext || "(none given)"}

VERIFIED FACTS (from ${research?.domain || "no website"}):
${verified}

INFERRED (hypotheses only):
${inferred}

OUR ORGANISATION:
${JSON.stringify(org)}

VALUE PROSPECT (what the sender believes is valuable to them): ${[...input.valueProps, input.customValue].filter(Boolean).join("; ") || "(not specified — choose the most relevant capability from our organisation)"}
TONE: ${input.tone}
EMAIL TYPE: ${input.emailType}${step ? `\n${stepGuide}` : ""}

PREVIOUS EMAILS TO THIS PERSON (never repeat them):
${hist}

SIGNATURE (end every body with exactly this):
${sender.signature}

${refine ? `REVISE this draft (option ${options[0]}). Instruction: ${refine.instruction}\nKeep every factual claim inside the allowed facts.\nCURRENT DRAFT:\nSubject: ${refine.subject}\n${refine.body}\n\n` : ""}Write ${options.length === 1 ? "this option" : "these options"}:
${options.map((o) => OPTION_BRIEFS[o]).join("\n")}

Return JSON: { "drafts": [ { "option": "A"|"B"|"C", "subjects": [2–3 short, specific, non-clickbait subject lines], "body": "email body including the signature", "used": [ { "claim": "short paraphrase of each factual claim you made about the prospect", "source": "S#"|"USER"|"CRM"|"ORG" } ] } ] }`;
}

const CHECK_SYSTEM = `You are a strict but fair fact-checker for outgoing B2B emails. Compare each draft with the ALLOWED FACTS.
Check the subject lines too. Flag ONLY sentences or subject lines that assert as fact something about the prospect, their company or the sender's organisation that the allowed facts do not support — e.g. invented clients, numbers, launches, funding, growth, awards, locations, technology, problems or results; an INFERRED need stated as certain; or a claim that the prospect replied or agreed when the history says otherwise.
Do NOT flag: conditional or hedged phrasing ("if…", "may", "could"), questions, the sender's offer or proposal of what they could do, restatements of the USER-PROVIDED context, greetings, the call to action or the signature.
Return JSON only: { "results": [ { "option": "A", "issues": [ { "sentence": "...", "reason": "..." } ] } ] }`;

function ruleIssues(draft) {
  const issues = [];
  for (const re of GENERIC_PHRASES) {
    const m = draft.body.match(re);
    if (m) issues.push({ sentence: m[0], reason: "Generic, unsupported personalization." });
  }
  const words = draft.body.split(/\s+/).filter(Boolean).length;
  if (words > 230) issues.push({ sentence: "(length)", reason: `Too long (${words} words); keep the body to 100–180 words.` });
  if (/\b(?:i noticed|i saw)\b/i.test(draft.body) && !draft.used.some((u) => /^S\d/.test(u.source))) issues.push({ sentence: draft.body.match(/\b(?:i noticed|i saw)\b[^.?!]*/i)[0], reason: "Claims to have noticed something without a verified source." });
  if (/\[[A-Z][a-zA-Z ]+\]/.test(draft.body)) issues.push({ sentence: draft.body.match(/\[[A-Z][a-zA-Z ]+\]/)[0], reason: "Unfilled placeholder." });
  return issues;
}

function cleanDraft(d, allowed) {
  const option = ["A", "B", "C"].includes(d?.option) ? d.option : null;
  if (!option) return null;
  const subjects = (Array.isArray(d.subjects) ? d.subjects : [d.subject]).map((s) => str(s, 140)).filter(Boolean).slice(0, 3);
  const body = String(d.body || "")
    .replace(/\r/g, "")
    .replace(/\s*[([](?:S\d+|CRM|USER|ORG)(?:\s*,\s*(?:S\d+|CRM|USER|ORG))*[)\]]/g, "")
    .trim()
    .slice(0, 6000);
  if (!body) return null;
  const used = (Array.isArray(d.used) ? d.used : [])
    .map((u) => ({ claim: str(u?.claim, 240), source: str(u?.source, 8).toUpperCase() }))
    .filter((u) => u.claim && (allowed.has(u.source) || ["USER", "CRM", "ORG"].includes(u.source)))
    .slice(0, 8);
  return { option, subjects: subjects.length ? subjects : ["Following up"], body, used };
}

// ── Router ────────────────────────────────────────────────────────────────────
function createProspectRouter(deps) {
  const router = express.Router();

  async function auth(req, res, action) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      res.status(401).json({ error: "Please sign in again." });
      return null;
    }
    const db = deps.dbFor(token);
    let check;
    try {
      check = await deps.checkLimit(db, { accessToken: token, action });
    } catch {
      res.status(503).json({ error: "Could not verify your session. Please try again." });
      return null;
    }
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return null;
    }
    return { db, userId: check.userId };
  }

  const fail = (res, err, fallback) => {
    console.warn("[prospect]", err?.message || err);
    res.status(err?.status || 502).json({ error: err?.publicMessage || fallback });
  };

  // 1–5. Research a contact's company and save a sourced brief
  router.post("/prospect/research", async (req, res) => {
    const a = await auth(req, res, "prospect_research");
    if (!a) return;
    try {
      const contactId = str(req.body?.contactId, 64);
      const { data: contact, error } = await a.db.from("contacts").select("*").eq("id", contactId).maybeSingle();
      if (error || !contact) return res.status(404).json({ error: "Contact not found." });

      // The user may correct details before research begins
      const edits = req.body?.edits || {};
      const patch = {};
      for (const k of ["name", "title", "company", "email", "phone", "website", "linkedin", "location", "industry", "domain"]) {
        if (typeof edits[k] === "string" && edits[k].trim() !== (contact[k] || "")) patch[k] = edits[k].trim().slice(0, 300);
      }
      if (patch.name === "") delete patch.name;
      Object.assign(contact, patch);

      const domain = resolveDomain(contact);
      const limitations = [];
      let web = { sources: [], socials: {}, org: {}, limitations: [] };
      if (domain) web = await gatherWebsite(domain, deps.fetchPage);
      else limitations.push("No company website or business email domain on this contact, so only your notes and the card details can be used. Add a website to enable research.");
      limitations.push(...web.limitations);

      const crmSource = {
        id: "CRM",
        kind: "crm",
        url: null,
        title: "Card / CRM details",
        text: [contact.name, contact.title, contact.company, contact.email, contact.phone, contact.website, contact.location, contact.event && `Met at ${contact.event}`].filter(Boolean).join(" · "),
      };

      let brief = { company: { name: contact.company || null, offerings: [], audience: [], initiatives: [], positioning: [], locations: [] }, person: { role_context: [] }, signals: [], potential_needs: [] };
      if (web.sources.length) {
        const raw = parseJson(await deps.llm({ system: EXTRACT_SYSTEM, user: extractPrompt(contact, web.sources), maxTokens: 1800, json: true, stage: "extract" }));
        brief = validateBrief(raw, web.sources);
      }
      brief.person.name = contact.name;
      brief.person.role = contact.title || null;
      brief.company.website = domain ? `https://${domain}` : null;
      if (!brief.company.name) brief.company.name = contact.company || web.org.name || null;

      // Store what the research found back on the contact (never overwrite the user's own values)
      if (domain && !contact.domain) patch.domain = domain;
      if (!contact.industry && brief.company.industry?.status === "verified") patch.industry = brief.company.industry.text.slice(0, 120);
      if (!contact.location && web.org.location) patch.location = web.org.location.slice(0, 160);
      const socials = { ...(contact.socials || {}), ...web.socials };
      if (contact.linkedin && !socials.linkedin) socials.linkedin = contact.linkedin;
      if (JSON.stringify(socials) !== JSON.stringify(contact.socials || {})) patch.socials = socials;
      if (Object.keys(patch).length) await a.db.from("contacts").update(patch).eq("id", contact.id);

      const sources = [
        ...web.sources.map(({ id, kind, url, title }) => ({ id, kind, url, title })),
        ...Object.entries(socials).map(([k, url]) => ({ id: `SOC-${k}`, kind: "social", url, title: `${k[0].toUpperCase()}${k.slice(1)} (link only)` })),
        { id: crmSource.id, kind: crmSource.kind, url: null, title: crmSource.title },
      ];
      const { data: saved, error: saveErr } = await a.db
        .from("prospect_research")
        .insert({ user_id: a.userId, contact_id: contact.id, domain, sources, brief, limitations })
        .select("*")
        .single();
      if (saveErr) throw saveErr;
      res.json({ research: saved, contact: { ...contact, ...patch } });
    } catch (err) {
      fail(res, err, "Research failed. Please try again.");
    }
  });

  // 7–14. Three drafts (or one regenerated / refined draft), fact-checked before display
  router.post("/prospect/draft", async (req, res) => {
    const a = await auth(req, res, "email_generation");
    if (!a) return;
    try {
      const b = req.body || {};
      const contactId = str(b.contactId, 64);
      const { data: contact } = await a.db.from("contacts").select("*").eq("id", contactId).maybeSingle();
      if (!contact) return res.status(404).json({ error: "Contact not found." });

      let research = null;
      if (b.researchId) {
        const { data } = await a.db.from("prospect_research").select("*").eq("id", str(b.researchId, 64)).maybeSingle();
        research = data;
      }
      const [{ data: org }, { data: profile }, { data: history }] = await Promise.all([
        a.db.from("organization_profiles").select("*").eq("user_id", a.userId).maybeSingle(),
        a.db.from("profiles").select("name, role, company, phone, linkedin, calendly_url").eq("id", a.userId).maybeSingle(),
        a.db.from("follow_up_emails").select("subject, draft, sent, sent_at, created_at, reply_status").eq("contact_id", contact.id).eq("sent", true).order("created_at", { ascending: true }).limit(6),
      ]);

      const input = {
        manualContext: str(b.manualContext, 2000),
        valueProps: (Array.isArray(b.valueProps) ? b.valueProps : []).map((v) => str(v, 60)).filter(Boolean).slice(0, 8),
        customValue: str(b.customValue, 400),
        tone: TONES.includes(b.tone) ? b.tone : org?.preferred_tone && TONES.includes(org.preferred_tone) ? org.preferred_tone : "Professional",
        emailType: EMAIL_TYPES.includes(b.emailType) ? b.emailType : "Networking follow-up",
      };
      const options = Array.isArray(b.options) && b.options.length ? b.options.filter((o) => ["A", "B", "C"].includes(o)).slice(0, 3) : ["A", "B", "C"];
      const refine =
        b.refine && options.length === 1 && REFINEMENTS[b.refine.kind]
          ? { instruction: REFINEMENTS[b.refine.kind], subject: str(b.refine.subject, 200), body: String(b.refine.body || "").slice(0, 6000) }
          : null;

      const senderName = profile?.name || "";
      const signature =
        str(org?.signature, 600) ||
        [senderName, [profile?.role, org?.company_name || profile?.company].filter(Boolean).join(", "), profile?.phone].filter(Boolean).join("\n");
      const orgFacts = org
        ? Object.fromEntries(Object.entries({ company: org.company_name, website: org.website, description: org.description, industry: org.industry, services: (org.services || []).join(", "), target_customers: org.target_customers, locations: org.locations, differentiators: org.differentiators, value_propositions: org.value_props, case_studies: org.case_studies, brand_voice: org.brand_voice }).filter(([, v]) => v))
        : { company: profile?.company || null, sender_role: profile?.role || null, note: "No organisation profile saved yet: describe our capability only in general terms the sender could stand behind." };

      const facts = factSheet(research?.brief || {});
      const allowedIds = new Set((research?.sources || []).map((s) => s.id));
      const hist = (history || []).map((h) => ({ ...h, body: h.draft }));

      const raw = parseJson(
        await deps.llm({
          system: DRAFT_SYSTEM,
          user: draftPrompt({ contact, research, facts, org: orgFacts, sender: { name: senderName, signature }, input, history: hist, options, refine }),
          maxTokens: 700 * options.length + 300,
          json: true,
        })
      );
      let drafts = (Array.isArray(raw?.drafts) ? raw.drafts : []).map((d) => cleanDraft(d, allowedIds)).filter(Boolean).filter((d) => options.includes(d.option));
      if (!drafts.length) throw Object.assign(new Error("no drafts"), { publicMessage: "The AI couldn't write drafts this time. Please try again." });

      // 12. Fact validation: rule checks + an independent AI fact-check, then one rewrite of flagged drafts
      const allowedText = [
        "VERIFIED:", ...facts.verified.map((f) => `[${f.source}] ${f.text}`),
        "USER-PROVIDED:", input.manualContext || "(none)", [contact.title, contact.company, contact.event && `met at ${contact.event}`].filter(Boolean).join(", "),
        "ORGANISATION:", JSON.stringify(orgFacts),
        "INFERRED (must not be stated as fact):", ...facts.inferred.map((f) => f.text),
        "HISTORY:", hist.length ? hist.map((h) => `sent ${String(h.sent_at).slice(0, 10)}, reply status ${h.reply_status}`).join("; ") : "no previous emails; the prospect has not replied to anything",
      ].join("\n");
      let checks = {};
      try {
        const verdict = parseJson(await deps.llm({ system: CHECK_SYSTEM, user: `ALLOWED FACTS:\n${allowedText}\n\nDRAFTS:\n${drafts.map((d) => `OPTION ${d.option}\nSUBJECT LINES: ${d.subjects.join(" | ")}\n${d.body}`).join("\n\n")}\n\nReturn exactly one result for each of these options: ${drafts.map((d) => d.option).join(", ")}.`, maxTokens: 700, json: true, stage: "check" }));
        if (process.env.PROSPECT_DEBUG) console.log("[prospect-verdict]", JSON.stringify(verdict));
        for (const r of verdict?.results || []) if (r?.option) checks[String(r.option).replace(/^option\s*/i, "").trim().toUpperCase()] = (r.issues || []).filter((i) => str(i?.sentence)).slice(0, 6);
      } catch (err) {
        console.warn("[prospect] fact-check skipped:", err.message);
      }
      if (process.env.PROSPECT_DEBUG) console.log("[prospect] drafts", JSON.stringify(drafts), "checks", JSON.stringify(checks));
      const flagged = drafts.map((d) => ({ d, issues: [...ruleIssues(d), ...(checks[d.option] || [])] })).filter((x) => x.issues.length);
      if (flagged.length) {
        try {
          const fix = parseJson(
            await deps.llm({
              system: DRAFT_SYSTEM,
              user: `ALLOWED FACTS:\n${allowedText}\n\nSIGNATURE:\n${signature}\n\nRewrite each draft below (subject lines and body) so that every listed problem is removed. Delete unsupported claims rather than rewording them. Keep the option's angle, tone and length.\n\n${flagged
                .map((x) => `OPTION ${x.d.option}\nSubject options: ${x.d.subjects.join(" | ")}\n${x.d.body}\nPROBLEMS:\n${x.issues.map((i) => `- "${i.sentence}": ${i.reason}`).join("\n")}`)
                .join("\n\n")}\n\nReturn JSON: { "drafts": [ { "option", "subjects", "body", "used" } ] }`,
              maxTokens: 700 * flagged.length + 200,
              json: true,
            })
          );
          for (const f of (fix?.drafts || []).map((d) => cleanDraft(d, allowedIds)).filter(Boolean)) {
            const i = drafts.findIndex((d) => d.option === f.option);
            if (i >= 0) drafts[i] = { ...f, revised: true };
          }
        } catch (err) {
          console.warn("[prospect] rewrite skipped:", err.message);
        }
      }
      drafts = drafts.map((d) => ({ ...d, checked: d.revised || d.option in checks, warnings: ruleIssues(d).map((i) => i.reason), words: d.body.split(/\s+/).filter(Boolean).length }));
      drafts.sort((x, y) => x.option.localeCompare(y.option));
      res.json({ drafts, factsUsed: { verified: facts.verified.length, inferred: facts.inferred.length }, tone: input.tone, emailType: input.emailType });
    } catch (err) {
      fail(res, err, "Couldn't write drafts. Please try again.");
    }
  });

  // 5. Pre-fill our organisation profile from its website (the user reviews before saving)
  router.post("/organization/autofill", async (req, res) => {
    const a = await auth(req, res, "prospect_research");
    if (!a) return;
    try {
      const domain = resolveDomain({ website: str(req.body?.website, 300) });
      if (!domain) return res.status(400).json({ error: "Enter your company website." });
      const web = await gatherWebsite(domain, deps.fetchPage);
      if (!web.sources.length) return res.status(422).json({ error: web.limitations[0] || "Couldn't read that website." });
      const raw = parseJson(
        await deps.llm({
          system: "You summarise a company's own website into a factual organisation profile for its sales team. Use only the sources. Leave a field empty when the sources don't say. No hype. Return JSON only.",
          user: `SOURCES:\n${sourceBlock(web.sources)}\n\nReturn JSON: { "company_name", "description" (2–3 sentences), "industry", "services": [short strings], "target_customers", "locations", "differentiators", "value_props", "case_studies" }`,
          maxTokens: 900,
          json: true,
          stage: "extract",
        })
      );
      const profile = { website: `https://${domain}`, socials: web.socials };
      for (const k of ["company_name", "description", "industry", "target_customers", "locations", "differentiators", "value_props", "case_studies"]) profile[k] = str(raw?.[k], 1200);
      profile.services = (Array.isArray(raw?.services) ? raw.services : []).map((s) => str(s, 80)).filter(Boolean).slice(0, 15);
      res.json({ profile, sources: web.sources.map(({ id, kind, url, title }) => ({ id, kind, url, title })), limitations: web.limitations });
    } catch (err) {
      fail(res, err, "Couldn't read your website. Please fill the profile in manually.");
    }
  });

  return router;
}

// ── Production wiring ─────────────────────────────────────────────────────────
function productionDeps() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const apiKey = process.env.GROQ_API_KEY;
  if (!url || !anon || !apiKey) return null;
  const robots = new Map();

  async function fetchPage(pageUrl) {
    const u = new URL(pageUrl);
    if (!robots.has(u.host)) {
      let rules = [];
      try {
        rules = parseRobots(await fetchHtml(`${u.protocol}//${u.host}/robots.txt`, 4000, 2, USER_AGENT));
      } catch {}
      robots.set(u.host, rules);
      if (robots.size > 500) robots.delete(robots.keys().next().value);
    }
    if (!robotsAllows(robots.get(u.host), u.pathname + u.search)) throw Object.assign(new Error("Disallowed by robots.txt"), { code: "ROBOTS" });
    return fetchHtml(pageUrl, 7000, 3, USER_AGENT);
  }

  // Each Groq model has its own per-minute budget, so the stages use different models
  const MODELS = { extract: TEXT_MODEL, draft: "openai/gpt-oss-120b", check: TEXT_MODEL };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function llm({ system, user, maxTokens, json, stage = "draft" }) {
    const call = async (model) => {
      const reasoning = /gpt-oss/.test(model);
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: maxTokens + (reasoning ? 500 : 0),
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          ...(reasoning ? { reasoning_effort: "low", include_reasoning: false } : {}),
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const wait = Number(r.headers.get("retry-after")) || 0;
        throw Object.assign(new Error(data?.error?.message || `AI error ${r.status}`), { code: data?.error?.code, status: r.status, wait });
      }
      return data?.choices?.[0]?.message?.content || "";
    };
    const primary = MODELS[stage] || TEXT_MODEL;
    const backup = primary === TEXT_MODEL ? FALLBACK_MODEL : TEXT_MODEL;
    try {
      return await call(primary);
    } catch (err) {
      if (err.code === "model_not_found" || err.status >= 500) return call(backup);
      if (err.status === 429 || err.status === 413) {
        // Per-minute limit: try the other model, then wait once if Groq says how long
        try {
          return await call(backup);
        } catch (err2) {
          const wait = Math.max(err.wait || 0, err2.wait || 0);
          if (wait && wait <= 20) {
            await sleep(wait * 1000);
            return call(primary).catch((e) => {
              throw Object.assign(e, { status: 503, publicMessage: "The AI is busy right now. Please try again in a minute." });
            });
          }
          throw Object.assign(err2, { status: 503, publicMessage: "The AI is busy right now. Please try again in a minute." });
        }
      }
      throw err;
    }
  }

  return {
    dbFor: (token) => createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }),
    checkLimit: verifyAndCheckLimit,
    fetchPage,
    llm,
  };
}

module.exports = {
  createProspectRouter,
  productionDeps,
  resolveDomain,
  extractPage,
  pickPages,
  gatherWebsite,
  validateBrief,
  factSheet,
  ruleIssues,
  cleanDraft,
  parseJson,
  extractPrompt,
  draftPrompt,
  EXTRACT_SYSTEM,
  DRAFT_SYSTEM,
  CHECK_SYSTEM,
  VALUE_OPTIONS,
  TONES,
  EMAIL_TYPES,
  REFINEMENTS,
};
