const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../api/waitlistAdmin/reports");

const NOW = Date.parse("2026-10-09T12:00:00Z"); // 17:30 IST
const at = (iso) => ({ created_at: iso });
const rows = [
  { id: "1", email: "a@gmail.com", created_at: "2026-10-09T05:00:00Z", status: "waiting", ref_code: "r1", utm_source: "Instagram" },
  { id: "2", email: "b@acme.io", created_at: "2026-10-08T20:00:00Z", status: "invited", ref_code: "r2", referred_by: "r1", referrer: "https://www.linkedin.com/x" },
  { id: "3", email: "c@acme.io", created_at: "2026-10-05T10:00:00Z", status: "joined", ref_code: "r3", referred_by: "r1", device: "mobile" },
  { id: "4", email: "d@yahoo.in", created_at: "2026-09-25T10:00:00Z", status: "waiting", ref_code: "r4", tags: ["VIP"] },
];

test("India calendar days: 18:30 UTC is already the next day in IST", () => {
  assert.equal(R.istDay("2026-10-08T18:29:00Z"), "2026-10-08");
  assert.equal(R.istDay("2026-10-08T18:31:00Z"), "2026-10-09");
});

test("filters: ranges in IST, custom dates, status, tag, source, search; junk values ignored", () => {
  const f = (q) => R.filterRows(rows, R.parseFilters(q), NOW).map((r) => r.id);
  assert.deepEqual(f({ range: "today" }), ["1", "2"]); // 2 is 01:30 IST on the 9th
  assert.deepEqual(f({ range: "7d" }), ["1", "2", "3"]);
  assert.deepEqual(f({ from: "2026-10-05", to: "2026-10-08" }), ["3"]);
  assert.deepEqual(f({ status: "waiting" }), ["1", "4"]);
  assert.deepEqual(f({ tag: "vip" }), ["4"]);
  assert.deepEqual(f({ source: "linkedin" }), ["2"]);
  assert.deepEqual(f({ q: "ACME" }), ["2", "3"]);
  assert.deepEqual(R.parseFilters({ range: "1y", status: "vip", from: "yesterday" }), { range: "all", from: "", to: "", status: "", tag: "", source: "", q: "" });
});

test("daily series and growth vs the previous 7 days", () => {
  const s = R.dailySeries(rows, 30, NOW);
  assert.equal(s.length, 30);
  assert.deepEqual(s.at(-1), { day: "2026-10-09", count: 2 });
  const k = R.kpis([...rows, at("2026-09-30T10:00:00Z"), at("2026-09-29T10:00:00Z")], NOW);
  assert.equal(k.last7, 3);
  assert.equal(k.prev7, 2);
  assert.equal(k.growth, 50);
  assert.equal(R.kpis([at("2026-10-09T05:00:00Z")], NOW).growth, null); // nothing to compare with
});

test("domains split personal vs company; sources fall back from utm → referrer → direct", () => {
  const d = R.domains(rows);
  assert.deepEqual(d.companies, [{ key: "acme.io", count: 2 }]);
  assert.equal(d.personal, 2);
  assert.deepEqual(R.sources(rows), [{ key: "direct", count: 2 }, { key: "instagram", count: 1 }, { key: "linkedin", count: 1 }]);
  // utm tags and referring pages for the same platform are counted together
  assert.deepEqual(R.sources([{ utm_source: "LinkedIn" }, { referrer: "https://www.linkedin.com/feed" }, { referrer: "https://lnkd.in/x" }, { utm_source: "ig" }]), [{ key: "linkedin", count: 3 }, { key: "instagram", count: 1 }]);
});

test("referrals and invite priority (most referrals, then queue order)", () => {
  const ref = R.referrals(rows);
  assert.equal(ref.referred, 2);
  assert.deepEqual(ref.top, [{ email: "a@gmail.com", id: "1", count: 2 }]);
  const order = R.priorityOrder([...rows.map((r) => ({ ...r })), { id: "5", email: "e@x.co", status: "waiting", position: 0, ref_code: "r5" }]);
  assert.deepEqual(order.map((r) => r.id), ["1", "5", "4"]);
});
