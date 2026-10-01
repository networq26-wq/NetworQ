const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createCrawler, parseRobots, robotsAllows, buildSources } = require("../../api/eventsCrawler");

const lumaEvent = fs.readFileSync(path.join(__dirname, "../fixtures/luma-event.html"), "utf8");
const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
const eventPage = (name, start) =>
  `<script type="application/ld+json">${JSON.stringify({ "@type": "Event", name, startDate: start, location: { "@type": "Place", name: "Hall" } })}</script>`;

test("robots.txt: NetworQBot group wins, longest match, allow beats disallow, wildcards", () => {
  const rules = parseRobots(`User-agent: *\nDisallow: /private\n\nUser-agent: NetworQBot\nDisallow: /e/secret\nAllow: /e/secret/ok\nDisallow: /*?calendar\n`);
  assert.equal(robotsAllows(rules, "/private"), true, "bot group replaces * group");
  assert.equal(robotsAllows(rules, "/e/secret/x"), false);
  assert.equal(robotsAllows(rules, "/e/secret/ok"), true);
  assert.equal(robotsAllows(rules, "/d/x?calendar=1"), false);
  assert.equal(robotsAllows(parseRobots("User-agent: *\nDisallow:\n"), "/anything"), true);
});

test("source list covers India and worldwide hubs with polite delays", () => {
  const s = buildSources();
  const cities = new Set(s.map((x) => x.city));
  for (const c of ["Hyderabad", "Bengaluru", "Mumbai", "Delhi", "Pune", "Chennai", "San Francisco", "London", "Singapore", "Dubai"]) assert.ok(cities.has(c), c);
  assert.ok(s.every((x) => x.delayMs >= 1500));
  assert.ok(s.filter((x) => x.id.startsWith("allevents")).every((x) => x.delayMs >= 10000), "AllEvents asks for 10 s");
});

function fakeWeb(pages) {
  const hits = [];
  return {
    hits,
    fetchText: async (url) => {
      hits.push(url);
      if (url in pages) return pages[url];
      throw new Error("404");
    },
  };
}

test("links source: follows event links (skipping site pages), extracts, tags city + source, dedupes", async () => {
  const web = fakeWeb({
    "https://lu.ma/robots.txt": "User-agent: *\nDisallow: /in/\n",
    "https://lu.ma/bangalore": `<a href="/discover">x</a><a href="/ai-night">a</a><a href="/ai-night">dup</a><a href="/old-meetup">b</a>`,
    "https://lu.ma/ai-night": eventPage("AI Night", future(3)),
    "https://lu.ma/old-meetup": eventPage("Old", "2020-01-01T10:00:00Z"),
  });
  const saved = [];
  const crawler = createCrawler({ fetchText: web.fetchText, saveEvents: async (r) => saved.push(...r), sleep: async () => {}, log: () => {}, sources: [{ id: "luma:Bengaluru", kind: "links", city: "Bengaluru", url: "https://lu.ma/bangalore", linkPattern: /href="\/([a-z0-9][a-z0-9-]{4,})"/gi, linkBase: "https://lu.ma/", limit: 5, delayMs: 1500 }] });
  const res = await crawler.run();
  assert.deepEqual(saved.map((e) => e.title), ["AI Night"], "past events dropped");
  assert.equal(saved[0].city, "Bengaluru");
  assert.equal(saved[0].source, "crawler");
  assert.equal(saved[0].url, "https://lu.ma/ai-night");
  assert.ok(!web.hits.includes("https://lu.ma/discover"), "site pages are not crawled");
  assert.equal(res.saved, 1);
});

test("listing source: events come straight from listing JSON-LD", async () => {
  const listing = `<script type="application/ld+json">${JSON.stringify([
    { "@type": "Event", name: "Founders Meetup", startDate: future(5), url: "https://www.meetup.com/g/events/1" },
    { "@type": "Event", name: "Product Night", startDate: future(9), url: "https://www.meetup.com/g/events/2" },
  ])}</script>`;
  const web = fakeWeb({ "https://www.meetup.com/robots.txt": "User-agent: *\nDisallow: /files/\n", "https://www.meetup.com/find/?location=in--Hyderabad&source=EVENTS": listing });
  const saved = [];
  await createCrawler({ fetchText: web.fetchText, saveEvents: async (r) => saved.push(...r), sleep: async () => {}, log: () => {}, sources: [{ id: "meetup:Hyderabad", kind: "listing", city: "Hyderabad", url: "https://www.meetup.com/find/?location=in--Hyderabad&source=EVENTS", delayMs: 2000 }] }).run();
  assert.deepEqual(saved.map((e) => e.url), ["https://www.meetup.com/g/events/1", "https://www.meetup.com/g/events/2"]);
  assert.ok(saved.every((e) => e.city === "Hyderabad"));
});

test("robots.txt disallow is honoured: the page is never fetched", async () => {
  const web = fakeWeb({ "https://blocked.test/robots.txt": "User-agent: *\nDisallow: /\n", "https://blocked.test/city": lumaEvent });
  const res = await createCrawler({ fetchText: web.fetchText, saveEvents: async () => {}, sleep: async () => {}, log: () => {}, sources: [{ id: "x", kind: "listing", city: "X", url: "https://blocked.test/city", delayMs: 1500 }] }).run();
  assert.equal(res.perSource.x, "robots");
  assert.ok(!web.hits.includes("https://blocked.test/city"));
});

test("waits between requests to the same host", async () => {
  const waits = [];
  const web = fakeWeb({
    "https://lu.ma/robots.txt": "",
    "https://lu.ma/sf": `<a href="/event-one">1</a><a href="/event-two">2</a>`,
    "https://lu.ma/event-one": eventPage("One", future(2)),
    "https://lu.ma/event-two": eventPage("Two", future(4)),
  });
  await createCrawler({ fetchText: web.fetchText, saveEvents: async () => {}, sleep: async (ms) => waits.push(ms), log: () => {}, sources: [{ id: "luma:SF", kind: "links", city: "San Francisco", url: "https://lu.ma/sf", linkPattern: /href="\/([a-z0-9][a-z0-9-]{4,})"/gi, linkBase: "https://lu.ma/", limit: 5, delayMs: 1500 }] }).run();
  assert.equal(waits.length, 2, "two follow-up requests waited");
  assert.ok(waits.every((ms) => ms > 1000 && ms <= 1500));
});

test("a failing source doesn't stop the others", async () => {
  const web = fakeWeb({ "https://ok.test/robots.txt": "", "https://ok.test/list": `<script type="application/ld+json">${JSON.stringify({ "@type": "Event", name: "Works", startDate: future(1) })}</script>` });
  const saved = [];
  const res = await createCrawler({
    fetchText: web.fetchText,
    saveEvents: async (r) => saved.push(...r),
    sleep: async () => {},
    log: () => {},
    sources: [
      { id: "down", kind: "listing", city: "A", url: "https://down.test/list", delayMs: 1500 },
      { id: "ok", kind: "listing", city: "B", url: "https://ok.test/list", delayMs: 1500 },
    ],
  }).run();
  assert.match(String(res.perSource.down), /error/);
  assert.equal(saved[0].title, "Works");
});
