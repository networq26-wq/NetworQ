// Guards the production runtime: @supabase/supabase-js needs native WebSocket (Node 22+).
// Node 20 in the Docker image crashed the server on boot (2026-10-01).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "../..");

const major = (s) => Number(String(s).match(/(\d+)/)?.[1]);

test("Docker base image runs Node 22 or newer", () => {
  const from = fs.readFileSync(path.join(root, "Dockerfile"), "utf8").match(/^FROM node:([\w.-]+)/m)?.[1];
  assert.ok(major(from) >= 22, `Dockerfile uses node:${from}`);
});

test("CI and package engines require Node 22 or newer", () => {
  const ci = fs.readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8").match(/node-version:\s*(\S+)/)?.[1];
  assert.ok(major(ci) >= 22, `CI uses Node ${ci}`);
  assert.ok(major(require(path.join(root, "package.json")).engines.node) >= 22);
});

test("a Supabase client can be created in this runtime (native WebSocket present)", () => {
  assert.equal(typeof globalThis.WebSocket, "function", `Node ${process.version} has no native WebSocket`);
  const { createClient } = require("@supabase/supabase-js");
  assert.doesNotThrow(() => createClient("https://example.supabase.co", "anon-key-placeholder"));
});
