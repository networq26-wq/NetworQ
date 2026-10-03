import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const M = ["20261003_account_email_events.sql", "20261004_events_crawler.sql", "20261009_events_categories.sql"];
const ins = (h, title, url, { city = "Bengaluru", starts = "2026-11-02T10:00:00Z", description = null } = {}) =>
  h.db.query("insert into public_events (title, starts_at, city, url, source_host, description) values ($1,$2,$3,$4,'x',$5)", [title, starts, city, url, description]);
const rows = async (h) => (await h.db.query("select title, url, category from public_events order by title")).rows;

test("events are categorised from their title and description", async () => {
  const h = await createDb(...M);
  const cases = [
    ["GenAI Builders Meetup", "AI & Data"],
    ["Founders & Investors Breakfast", "Startups"],
    ["India Mobile Congress 2026", "Conferences & Expos"],
    ["Hands-on Figma Workshop", "Workshops"],
    ["Growth Marketing Night", "Marketing & Sales"],
    ["DevOps Days Pune", "Tech"],
    ["Web3 & DeFi Evening", "Finance & Web3"],
    ["HackBLR 48h Hackathon", "Hackathons"],
    ["Friday Professionals Mixer", "Networking"],
    ["Quarterly Business Review Session", "Business"],
  ];
  for (const [i, [title]] of cases.entries()) await ins(h, title, `https://e.test/${i}`);
  const got = Object.fromEntries((await rows(h)).map((r) => [r.title, r.category]));
  for (const [title, cat] of cases) assert.equal(got[title], cat, title);
});

test("the same event from a second site is skipped; same URL still updates", async () => {
  const h = await createDb(...M);
  await ins(h, "TechSparks 2026: The New Tech Order", "https://lu.ma/techsparks");
  await ins(h, "TechSparks 2026 — The New Tech Order!", "https://allevents.in/bangalore/techsparks", { starts: "2026-11-02T18:00:00Z" });
  await ins(h, "TechSparks 2026: The New Tech Order", "https://other.test/x", { city: "Mumbai" }); // different city = different event
  assert.deepEqual((await rows(h)).map((r) => r.url).sort(), ["https://lu.ma/techsparks", "https://other.test/x"]);
  await h.db.query("insert into public_events (title, starts_at, city, url, source_host) values ('TechSparks 2026: The New Tech Order', '2026-11-02T10:00:00Z', 'Bengaluru', 'https://lu.ma/techsparks', 'x') on conflict (url) do update set venue = 'BIEC'");
  assert.equal((await h.db.query("select venue from public_events where url = 'https://lu.ma/techsparks'")).rows[0].venue, "BIEC");
});
