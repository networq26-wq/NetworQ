const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const p = require("../../api/prospect");
const { createFakeSupabase } = require("./helpers/fakeSupabase");

const HOME = `<html><head><title>Acme Logistics — Freight software</title>
<meta name="description" content="Acme builds route-planning software for mid-size freight carriers.">
<script type="application/ld+json">{"@type":"Organization","name":"Acme Logistics","sameAs":["https://www.linkedin.com/company/acme-logistics"],"address":{"addressLocality":"Pune","addressCountry":"IN"}}</script>
</head><body><nav><a href="/about">About us</a><a href="/services">Services</a><a href="/blog">Blog</a><a href="/careers">Careers</a></nav>
<h1>Plan every route in minutes</h1><p>Acme builds route-planning software for mid-size freight carriers across India.</p>
<p>We just opened a new office in Bengaluru to support our southern customers.</p>
<a href="https://instagram.com/acmelogistics">Instagram</a><script>var x = "ignore me";</script></body></html>`;
const ABOUT = `<html><head><title>About Acme</title></head><body><p>Founded in 2015, Acme serves more than 400 carriers. Our mission is to make freight planning simple for regional fleets.</p></body></html>`;
const SERVICES = `<html><head><title>Services</title></head><body><p>Route optimisation, fleet tracking dashboards and driver mobile apps for regional fleets and 3PL companies.</p></body></html>`;

test("domain resolution: website first, then business email, never free mail", () => {
  assert.equal(p.resolveDomain({ website: "https://www.acme.io/about" }), "acme.io");
  assert.equal(p.resolveDomain({ email: "ravi@acme-logistics.in" }), "acme-logistics.in");
  assert.equal(p.resolveDomain({ email: "ravi@gmail.com" }), null);
  assert.equal(p.resolveDomain({ domain: "Acme.com", website: "other.com" }), "acme.com");
});

test("page extraction keeps readable text, drops scripts/nav, finds socials and JSON-LD", () => {
  const ex = p.extractPage(HOME, "https://acme.test/");
  assert.match(ex.text, /route-planning software for mid-size freight carriers/);
  assert.doesNotMatch(ex.text, /ignore me|About us/);
  assert.equal(ex.org.name, "Acme Logistics");
  assert.equal(ex.org.location, "Pune, IN");
  assert.equal(ex.socials.linkedin, "https://www.linkedin.com/company/acme-logistics");
  assert.equal(ex.socials.instagram, "https://instagram.com/acmelogistics");
  const picks = p.pickPages(ex.links, "https://acme.test/");
  assert.deepEqual(picks.map((x) => x.kind), ["about", "services", "news", "careers"]);
});

test("a fact is verified only when its quote appears in the cited source", () => {
  const sources = [{ id: "S1", text: "We just opened a new office in Bengaluru to support our southern customers.", title: "Home" }];
  const brief = p.validateBrief(
    {
      company: { name: "Acme", initiatives: [{ text: "Opened a Bengaluru office", source: "S1", evidence: "opened a new office in Bengaluru" }], offerings: [{ text: "Raised Series B", source: "S1", evidence: "raised a Series B round" }], locations: [{ text: "Dubai", source: "S9", evidence: "office in Dubai" }] },
      signals: [{ text: "Expanding south", source: "S1", evidence: "to support our southern customers" }],
      potential_needs: [{ text: "May need local hiring", based_on: ["S1", "S7"] }],
    },
    sources
  );
  assert.equal(brief.company.initiatives[0].status, "verified");
  assert.equal(brief.company.offerings[0].status, "unverified", "invented quote is not verified");
  assert.equal(brief.company.locations[0].status, "unverified");
  assert.equal(brief.company.locations[0].source, null, "unknown source id dropped");
  assert.equal(brief.signals[0].status, "verified");
  assert.deepEqual(brief.potential_needs[0], { text: "May need local hiring", status: "inferred", based_on: ["S1"] });
  const sheet = p.factSheet(brief);
  assert.deepEqual(sheet.verified.map((f) => f.text), ["Initiative: Opened a Bengaluru office", "Signal: Expanding south"]);
});

test("drafts: citation markers stripped, unknown sources dropped, generic phrases flagged", () => {
  const d = p.cleanDraft({ option: "B", subjects: ["Hi"], body: "I noticed you opened a Bengaluru office (S1). As a leader in your industry [S2, CRM] you…", used: [{ claim: "office", source: "S1" }, { claim: "x", source: "S7" }, { claim: "met", source: "user" }] }, new Set(["S1"]));
  assert.equal(d.body, "I noticed you opened a Bengaluru office. As a leader in your industry you…");
  assert.deepEqual(d.used.map((u) => u.source), ["S1", "USER"]);
  assert.ok(p.ruleIssues(d).some((i) => /Generic/.test(i.reason)));
  const noSource = p.cleanDraft({ option: "A", subjects: ["Hi"], body: "I noticed your team is hiring.", used: [] }, new Set());
  assert.ok(p.ruleIssues(noSource).some((i) => /without a verified source/.test(i.reason)));
  assert.equal(p.cleanDraft({ option: "Z", body: "x" }, new Set()), null);
});

// ── Router ────────────────────────────────────────────────────────────────────
function harness({ pages = {}, robotsBlocked = false, llmReplies = [], limit = { ok: true, userId: "u1" }, tables = {} } = {}) {
  const prompts = [];
  const db = createFakeSupabase({
    contacts: [{ id: "c1", user_id: "u1", name: "Ravi Iyer", title: "COO", company: "Acme", email: "ravi@acme.test", event: "Logistics Summit", socials: {}, location: "Mumbai" }],
    profiles: [{ id: "u1", name: "Asha Rao", role: "Founder", company: "Brightline", phone: "+91 90000 11111" }],
    ...tables,
  });
  const deps = {
    dbFor: () => db,
    checkLimit: async (_db, { accessToken, action }) => (accessToken === "tok" ? { ...limit, action } : { ok: false, status: 401, error: "Invalid or expired session." }),
    fetchPage: async (url) => {
      if (robotsBlocked) throw Object.assign(new Error("robots"), { code: "ROBOTS" });
      if (pages[url]) return pages[url];
      throw new Error("HTTP 404");
    },
    llm: async (args) => {
      prompts.push(args);
      const next = llmReplies.shift();
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next(args) : JSON.stringify(next || {});
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api", p.createProspectRouter(deps));
  return { app, db, prompts };
}

async function call(app, path, body, token = "tok") {
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  } finally {
    srv.close();
  }
}

const SITE = { "https://acme.test/": HOME, "https://acme.test/about": ABOUT, "https://acme.test/services": SERVICES };
const EXTRACTION = {
  company: {
    name: "Acme Logistics",
    industry: { text: "Freight software", source: "S1", evidence: "route-planning software for mid-size freight carriers" },
    offerings: [{ text: "Route optimisation and fleet tracking", source: "S3", evidence: "Route optimisation, fleet tracking dashboards and driver mobile apps" }],
    initiatives: [{ text: "Raised $20M", source: "S2", evidence: "raised twenty million dollars" }],
  },
  signals: [{ text: "New Bengaluru office", source: "S1", evidence: "opened a new office in Bengaluru" }],
  potential_needs: [{ text: "May want more southern carriers as customers", based_on: ["S1"] }],
};

test("research requires a session and respects the daily cap", async () => {
  const h = harness();
  assert.equal((await call(h.app, "/prospect/research", { contactId: "c1" }, null)).status, 401);
  const capped = harness({ limit: { ok: false, status: 429, error: "Daily limit reached: 20 research per day." } });
  const r = await call(capped.app, "/prospect/research", { contactId: "c1" });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /Daily limit/);
});

test("research reads the site, verifies quotes, saves a sourced brief and enriches the contact without overwriting", async () => {
  const h = harness({ pages: SITE, llmReplies: [EXTRACTION], tables: { contacts: [{ id: "c1", user_id: "u1", name: "Ravi Iyer", title: "COO", company: "Acme", email: "ravi@acme.test", socials: {}, location: "Mumbai", website: "acme.test" }] } });
  const r = await call(h.app, "/prospect/research", { contactId: "c1", edits: { title: "Chief Operating Officer" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { research, contact } = r.body;
  assert.equal(research.domain, "acme.test");
  assert.deepEqual(research.sources.filter((s) => /^S\d/.test(s.id)).map((s) => s.kind), ["homepage", "about", "services"]);
  assert.ok(research.sources.some((s) => s.kind === "social" && /linkedin/.test(s.url)));
  assert.ok(research.limitations.some((l) => /need sign-in/.test(l)), "social limitation stated");
  assert.equal(research.brief.company.industry.status, "verified");
  assert.equal(research.brief.company.initiatives[0].status, "unverified", "invented funding is not verified");
  assert.equal(research.brief.signals[0].status, "verified");
  assert.equal(contact.title, "Chief Operating Officer", "user edit applied");
  assert.equal(contact.location, "Mumbai", "user's location kept");
  assert.equal(h.db.db.contacts[0].domain, "acme.test");
  assert.equal(h.db.db.contacts[0].industry, "Freight software");
  assert.equal(h.db.db.prospect_research.length, 1);
  assert.equal(h.prompts[0].stage, "extract");
  assert.doesNotMatch(h.prompts[0].user, /ignore me/, "scripts are not sent to the AI");
});

test("robots.txt refusal and missing website are reported as limitations, with no AI call", async () => {
  const blocked = harness({ robotsBlocked: true });
  const r = await call(blocked.app, "/prospect/research", { contactId: "c1" });
  assert.equal(r.status, 200);
  assert.match(r.body.research.limitations[0], /robots\.txt/);
  assert.equal(blocked.prompts.length, 0);

  const noSite = harness({ tables: { contacts: [{ id: "c1", user_id: "u1", name: "Ravi", email: "ravi@gmail.com", socials: {} }] } });
  const r2 = await call(noSite.app, "/prospect/research", { contactId: "c1" });
  assert.match(r2.body.research.limitations[0], /No company website/);
  assert.equal(noSite.prompts.length, 0);
});

const BRIEF = p.validateBrief(EXTRACTION, [
  { id: "S1", title: "Home", text: "Acme builds route-planning software for mid-size freight carriers across India. We just opened a new office in Bengaluru to support our southern customers." },
  { id: "S3", title: "Services", text: "Route optimisation, fleet tracking dashboards and driver mobile apps for regional fleets." },
]);
const RESEARCH = { id: "r1", user_id: "u1", contact_id: "c1", domain: "acme.test", sources: [{ id: "S1" }, { id: "S3" }, { id: "CRM" }], brief: BRIEF };
const ORG = { user_id: "u1", company_name: "Brightline", description: "Growth marketing for logistics companies", services: ["Lead generation", "Paid search"], preferred_tone: "Friendly" };
const draft = (option, body, used = []) => ({ option, subjects: [`Subject ${option}`, `Alt ${option}`], body: `${body}\n\nAsha Rao\nFounder, Brightline`, used });

test("three drafts combine research, manual context, org profile and value; unverified facts never reach the writer", async () => {
  const h = harness({
    tables: { prospect_research: [RESEARCH], organization_profiles: [ORG], follow_up_emails: [] },
    llmReplies: [
      { drafts: [draft("A", "Great meeting you at Logistics Summit."), draft("B", "Saw the new Bengaluru office.", [{ claim: "Bengaluru office", source: "S1" }]), draft("C", "If adding southern carriers is a priority, we could help.")] },
      { results: [{ option: "A", issues: [] }, { option: "B", issues: [] }, { option: "C", issues: [] }] },
    ],
  });
  const r = await call(h.app, "/prospect/draft", { contactId: "c1", researchId: "r1", manualContext: "They want more carriers in the south", valueProps: ["Lead generation"], customValue: "Carrier webinars", tone: "Executive", emailType: "Sales outreach" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.drafts.map((d) => d.option), ["A", "B", "C"]);
  assert.ok(r.body.drafts.every((d) => d.checked && d.subjects.length === 2 && /Asha Rao/.test(d.body)));
  assert.deepEqual(r.body.drafts[1].used, [{ claim: "Bengaluru office", source: "S1" }]);
  const prompt = h.prompts[0].user;
  assert.match(prompt, /They want more carriers in the south/);
  assert.match(prompt, /Lead generation; Carrier webinars/);
  assert.match(prompt, /Growth marketing for logistics companies/);
  assert.match(prompt, /\[S1\] Signal: New Bengaluru office/);
  assert.match(prompt, /May want more southern carriers/);
  assert.match(prompt, /TONE: Executive/);
  assert.doesNotMatch(prompt, /\$20M/, "unverified fact withheld from the writer");
  assert.match(h.prompts[1].system, /fact-checker/);
  assert.equal(h.prompts[1].stage, "check");
});

test("flagged drafts are rewritten once and the problems are passed to the rewrite", async () => {
  const h = harness({
    tables: { prospect_research: [RESEARCH], organization_profiles: [ORG] },
    llmReplies: [
      { drafts: [draft("A", "Hi Ravi."), draft("B", "Congrats on your $20M raise!"), draft("C", "I hope this email finds you well.")] },
      { results: [{ option: "A", issues: [] }, { option: "Option B", issues: [{ sentence: "Congrats on your $20M raise!", reason: "Not in allowed facts" }] }, { option: "C", issues: [] }] },
      { drafts: [draft("B", "Saw the Bengaluru office news."), draft("C", "Quick idea for southern carriers.")] },
    ],
  });
  const r = await call(h.app, "/prospect/draft", { contactId: "c1", researchId: "r1" });
  assert.equal(r.status, 200);
  const rewrite = h.prompts[2].user;
  assert.match(rewrite, /Congrats on your \$20M raise!.*Not in allowed facts/);
  assert.match(rewrite, /Generic, unsupported personalization/, "rule-based issue on C included");
  const byOpt = Object.fromEntries(r.body.drafts.map((d) => [d.option, d]));
  assert.match(byOpt.B.body, /Bengaluru office news/);
  assert.ok(byOpt.B.revised && byOpt.C.revised && !byOpt.A.revised);
  assert.equal(r.body.tone, "Friendly", "org preferred tone used by default");
});

test("follow-ups see previous emails and their (non-)reply status; refine rewrites one option", async () => {
  const sent = { id: "e1", user_id: "u1", contact_id: "c1", subject: "Intro from Brightline", draft: "Hi Ravi, first email", sent: true, sent_at: "2026-09-20T10:00:00Z", created_at: "2026-09-20T10:00:00Z", reply_status: "none" };
  const h = harness({
    tables: { prospect_research: [RESEARCH], organization_profiles: [ORG], follow_up_emails: [sent] },
    llmReplies: [{ drafts: [draft("C", "Just closing the loop.")] }, { results: [{ option: "C", issues: [] }] }],
  });
  const r = await call(h.app, "/prospect/draft", { contactId: "c1", researchId: "r1", emailType: "Follow-up", options: ["C"], refine: { kind: "shorter", subject: "Old", body: "Old long body" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.drafts.map((d) => d.option), ["C"]);
  const prompt = h.prompts[0].user;
  assert.match(prompt, /Intro from Brightline/);
  assert.match(prompt, /reply status: none/);
  assert.match(prompt, /FOLLOW-UP 1/);
  assert.match(prompt, /REVISE this draft \(option C\)\. Instruction: Make it shorter/);
  assert.match(prompt, /Old long body/);
});

test("drafts work without research or an organisation profile, and a missing contact is a 404", async () => {
  const h = harness({ llmReplies: [{ drafts: [draft("A", "Hi"), draft("B", "Hi"), draft("C", "Hi")] }, new Error("checker down")] });
  const r = await call(h.app, "/prospect/draft", { contactId: "c1" });
  assert.equal(r.status, 200);
  assert.ok(r.body.drafts.every((d) => d.checked === false), "unchecked drafts are labelled as such");
  assert.match(h.prompts[0].user, /No organisation profile saved yet/);
  assert.match(h.prompts[0].user, /the website could not be researched/);
  assert.equal((await call(h.app, "/prospect/draft", { contactId: "zzz" })).status, 404);
});

test("organisation autofill reads the website and returns an editable profile", async () => {
  const h = harness({ pages: SITE, llmReplies: [{ company_name: "Acme Logistics", description: "Route software.", services: ["Route optimisation", 42, ""], locations: "Pune" }] });
  const r = await call(h.app, "/organization/autofill", { website: "acme.test" });
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.company_name, "Acme Logistics");
  assert.deepEqual(r.body.profile.services, ["Route optimisation"]);
  assert.equal(r.body.profile.website, "https://acme.test");
  assert.equal(r.body.profile.socials.linkedin, "https://www.linkedin.com/company/acme-logistics");
  assert.equal((await call(h.app, "/organization/autofill", { website: "" })).status, 400);
});
