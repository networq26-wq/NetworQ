const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isAllowedOrigin } = require("./cors");

test("allows an origin present in the list", () => {
  assert.equal(isAllowedOrigin("http://localhost:8081", "http://localhost:8081,https://networq.app"), true);
});

test("rejects an origin absent from the list", () => {
  assert.equal(isAllowedOrigin("https://evil.example", "http://localhost:8081,https://networq.app"), false);
});

test("rejects when there is no origin header", () => {
  assert.equal(isAllowedOrigin(undefined, "http://localhost:8081"), false);
});

test("ignores extra whitespace around entries", () => {
  assert.equal(isAllowedOrigin("https://networq.app", " http://localhost:8081 , https://networq.app "), true);
});

test("rejects everything when the allow-list is empty or unset", () => {
  assert.equal(isAllowedOrigin("http://localhost:8081", ""), false);
  assert.equal(isAllowedOrigin("http://localhost:8081", undefined), false);
});

