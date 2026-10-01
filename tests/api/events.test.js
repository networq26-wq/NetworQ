const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { extractJsonLdEvents, parseIcsEvents, createEventsRouter } = require("../../api/events");

const fx = (name) => fs.readFileSync(path.join(__dirname, "../fixtures", name), "utf8");

test("JSON-LD Event is extracted with real fields only", () => {
  const [e] = extractJsonLdEvents(fx("luma-event.html"), "https://lu.ma/ai-builders-hyd");
  assert.equal(e.title, "AI Builders Night Hyderabad");
  assert.equal(e.starts_at, new Date("2030-11-14T18:30:00+05:30").toISOString());
  assert.equal(e.venue, "T-Hub, Raidurg");
  assert.equal(e.city, "Hyderabad");
  assert.equal(e.image, "https://images.lumacdn.com/event.png");
  assert.equal(e.organizer, "Hyderabad AI Collective");
  assert.equal(e.url, "https://lu.ma/ai-builders-hyd");
  assert.equal(e.source_host, "lu.ma");
});

test("@graph, typed-array Event subtypes, online events and entities are handled", () => {
  const [e] = extractJsonLdEvents(fx("graph-event.html"), "https://example.org/mixer");
  assert.equal(e.title, "Founders & Funders Mixer");
  assert.equal(e.venue, "Online");
  assert.equal(e.city, null);
  assert.equal(e.image, "https://img.test/a.jpg");
  assert.equal(e.url, "https://example.org/mixer", "falls back to the page URL");
});

test("pages without an Event, or with broken JSON-LD, yield nothing (no invention)", () => {
  assert.deepEqual(extractJsonLdEvents(fx("no-event.html"), "https://blog.test/x"), []);
});

test("ICS feeds yield only future events, each with a unique URL", () => {
  const events = parseIcsEvents(fx("calendar.ics"), "https://api.lu.ma/ics/get?entity=calendar&id=cal-1");
  assert.deepEqual(events.map((e) => e.title), ["Bangalore Product Circle", "Founder Coffee"]);
  assert.equal(events[0].url, "https://lu.ma/product-circle-blr");
  assert.equal(events[0].venue, "91springboard, Koramangala, Bengaluru");
  assert.match(events[1].url, /^https:\/\/api\.lu\.ma\/ics\/get\?entity=calendar&id=cal-1#future-2%40test$/);
  assert.equal(events[1].source_host, "api.lu.ma");
});

function harness(pages) {
  const saved = [];
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createEventsRouter({
      getUser: async (t) => (t === "tok" ? { id: "u1" } : null),
      fetchText: async (url) => {
        if (!(url in pages)) throw new Error("Target host is not allowed");
        return pages[url];
      },
      saveEvents: async (rows) => {
        saved.push(...rows);
        return rows.map((r, i) => ({ id: `id-${i}`, ...r }));
      },
    })
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (body, token = "tok") =>
    fetch(base + "/events/import", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { saved, post, close: () => server.close() };
}

test("import endpoint: auth, URL validation, extraction, saving with creator", async () => {
  const h = harness({ "https://lu.ma/ai-builders-hyd": fx("luma-event.html"), "https://blog.test/x": fx("no-event.html") });
  try {
    assert.equal((await h.post({ url: "https://lu.ma/ai-builders-hyd" }, null)).status, 401);
    assert.equal((await h.post({ url: "javascript:alert(1)" })).status, 400);
    const ok = await (await h.post({ url: "https://lu.ma/ai-builders-hyd" })).json();
    assert.equal(ok.events.length, 1);
    assert.equal(h.saved[0].created_by, "u1");
    const none = await h.post({ url: "https://blog.test/x" });
    assert.equal(none.status, 422);
    assert.match((await none.json()).error, /couldn't find event details/i);
    const blocked = await h.post({ url: "http://169.254.169.254/latest" });
    assert.equal(blocked.status, 422);
  } finally {
    h.close();
  }
});
