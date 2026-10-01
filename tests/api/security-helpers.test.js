const test = require("node:test");
const assert = require("node:assert/strict");
const { isPrivateAddress, assertPublicUrl } = require("../../api/enrich");
const { escapeHtml } = require("../../api/reminders");
const { verifyAndCheckLimit } = require("../../api/_lib/verifyAndLimit");

test("isPrivateAddress flags internal ranges", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test("isPrivateAddress allows public addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("assertPublicUrl rejects non-http schemes and literal private IPs", async () => {
  await assert.rejects(assertPublicUrl(new URL("ftp://example.com")));
  await assert.rejects(assertPublicUrl(new URL("http://192.168.0.10/")));
  await assert.rejects(assertPublicUrl(new URL("http://[::1]/")));
});

test("escapeHtml neutralises markup", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(escapeHtml(null), "");
});

test("dev bypass tokens only work outside production", async () => {
  const prev = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    assert.equal((await verifyAndCheckLimit(null, { accessToken: "mock-1", action: "chat" })).ok, true);
    process.env.NODE_ENV = "production";
    const r = await verifyAndCheckLimit(null, { accessToken: "mock-1", action: "chat" });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  } finally {
    process.env.NODE_ENV = prev;
  }
});
