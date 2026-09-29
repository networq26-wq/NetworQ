# Security Hardening & Production Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the open-proxy vulnerability in the AI endpoint, lock down CORS, add missing Storage bucket policies, and document the production env vars — so the app can't be abused to burn API credits and secrets are managed correctly.

**Architecture:** Extract the auth/rate-limit logic into a small, dependency-injected, framework-free JS module (`api/_lib/verifyAndLimit.js`) that both the Vercel serverless function and the local Express server import — no duplicated logic. The module and a small CORS-origin helper are pure functions, unit-tested with Node's built-in test runner (`node --test`) — no new test framework dependency. The Storage bucket + policies are added as plain SQL to `schema.sql`. This plan does **not** change which AI provider is called (that's the separate AI-provider-swap plan) — it only adds the auth gate around whatever provider the proxy currently forwards to.

**Tech Stack:** Node.js (`node:test`, built-in, no new dependency), `@supabase/supabase-js` (already a dependency), plain SQL for Supabase Storage policies.

**Spec:** `docs/superpowers/specs/2026-08-27-premium-relaunch-design.md`, section 1 ("Security Hardening") and the storage-bucket/`.env.example` parts of section 5.

## Global Constraints

- Server-side secrets (`GROQ_API_KEY`/`ANTHROPIC_API_KEY`) must never be read from an `EXPO_PUBLIC_*` variable or sent to the client.
- No new rate-limiting infrastructure (no Redis/Upstash) — the existing Postgres `ai_usage` table + `increment_ai_usage` RPC is the rate limiter; this plan only moves its enforcement server-side.
- `action` values that carry a daily cap are exactly `"email_generation"` and `"card_scan"` (matches the `check` constraint already in `schema.sql`). Chat requests (no cap in the current app) still require a valid auth token but are not passed through `increment_ai_usage`.
- Every code file in this plan is plain JavaScript (not TypeScript) so it can run directly under `node --test` without a build step.

---

### Task 1: Add the test runner and `.env.example`

**Files:**
- Modify: `package.json`
- Create: `.env.example`

**Interfaces:**
- Produces: `npm test` runs `node --test` across the repo.

- [ ] **Step 1: Add the test script**

In `package.json`, inside `"scripts"`, add:

```json
    "test": "node --test"
```

(Full `scripts` block becomes:)

```json
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "test": "node --test"
  },
```

- [ ] **Step 2: Verify the script runs (with nothing to test yet)**

Run: `npm test`
Expected: `node --test` exits 0 with "tests 0" (no `*.test.js` files exist yet — that's fine, confirms the command itself works).

- [ ] **Step 3: Write `.env.example`**

Create `.env.example`:

```bash
# Supabase (client-safe — EXPO_PUBLIC_* is bundled into the web/app build)
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# AI provider (server-side only — never prefix with EXPO_PUBLIC_)
GROQ_API_KEY=your-groq-api-key

# EmailJS (client-safe)
EXPO_PUBLIC_EMAILJS_SERVICE_ID=your-emailjs-service-id
EXPO_PUBLIC_EMAILJS_TEMPLATE_ID=your-emailjs-template-id
EXPO_PUBLIC_EMAILJS_PUBLIC_KEY=your-emailjs-public-key

# Google Calendar (optional — omit to fall back to a generated Meet link + email invite)
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your-google-oauth-client-id

# Server-side CORS allow-list for the AI proxy, comma-separated, no trailing slashes
ALLOWED_ORIGIN=http://localhost:8081,http://localhost:19006
```

- [ ] **Step 4: Commit**

```bash
git add package.json .env.example
git commit -m "chore: add node --test runner and .env.example"
```

---

### Task 2: `isAllowedOrigin` CORS helper

**Files:**
- Create: `api/_lib/cors.js`
- Test: `api/_lib/cors.test.js`

**Interfaces:**
- Produces: `isAllowedOrigin(origin, allowListCsv)` → `boolean`. `allowListCsv` is the raw `ALLOWED_ORIGIN` env var string.

- [ ] **Step 1: Write the failing test**

Create `api/_lib/cors.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test api/_lib/cors.test.js`
Expected: FAIL — `Cannot find module './cors'`

- [ ] **Step 3: Write the implementation**

Create `api/_lib/cors.js`:

```js
function isAllowedOrigin(origin, allowListCsv) {
  if (!origin || !allowListCsv) return false;
  const allowList = allowListCsv.split(",").map(s => s.trim()).filter(Boolean);
  return allowList.includes(origin);
}

module.exports = { isAllowedOrigin };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test api/_lib/cors.test.js`
Expected: PASS, 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/cors.js api/_lib/cors.test.js
git commit -m "feat: add CORS allow-list helper with tests"
```

---

### Task 3: `verifyAndCheckLimit` auth + usage-limit helper

**Files:**
- Create: `api/_lib/verifyAndLimit.js`
- Test: `api/_lib/verifyAndLimit.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (standalone module).
- Produces: `async verifyAndCheckLimit(client, { accessToken, action })` →
  `{ ok: true, userId: string }` or
  `{ ok: false, status: 401 | 429 | 500, error: string }`.
  `client` is any object shaped like a `supabase-js` client (dependency-injected so tests don't need a real Supabase project). `action` is one of `"email_generation" | "card_scan" | "chat"`. For `"chat"`, the function checks the token but skips the `increment_ai_usage` call entirely (chat has no daily cap in this app).

- [ ] **Step 1: Write the failing test**

Create `api/_lib/verifyAndLimit.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verifyAndCheckLimit } = require("./verifyAndLimit");

function fakeClient({ getUserResult, rpcResult }) {
  return {
    auth: { getUser: async () => getUserResult },
    rpc: async () => rpcResult,
  };
}

test("rejects when accessToken is missing", async () => {
  const client = fakeClient({ getUserResult: { data: { user: null }, error: null }, rpcResult: {} });
  const result = await verifyAndCheckLimit(client, { accessToken: "", action: "card_scan" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("rejects an invalid/expired token", async () => {
  const client = fakeClient({
    getUserResult: { data: { user: null }, error: { message: "invalid JWT" } },
    rpcResult: {},
  });
  const result = await verifyAndCheckLimit(client, { accessToken: "bad-token", action: "card_scan" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("allows a chat request with a valid token and never calls the usage RPC", async () => {
  let rpcCalled = false;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: async () => { rpcCalled = true; return { data: null, error: null }; },
  };
  const result = await verifyAndCheckLimit(client, { accessToken: "good-token", action: "chat" });
  assert.equal(result.ok, true);
  assert.equal(result.userId, "user-1");
  assert.equal(rpcCalled, false);
});

test("allows a card_scan request when the usage RPC reports allowed:true", async () => {
  const client = fakeClient({
    getUserResult: { data: { user: { id: "user-1" } }, error: null },
    rpcResult: { data: { allowed: true, used: 3, limit: 10, remaining: 7 }, error: null },
  });
  const result = await verifyAndCheckLimit(client, { accessToken: "good-token", action: "card_scan" });
  assert.equal(result.ok, true);
  assert.equal(result.userId, "user-1");
});

test("rejects with 429 when the usage RPC reports allowed:false", async () => {
  const client = fakeClient({
    getUserResult: { data: { user: { id: "user-1" } }, error: null },
    rpcResult: { data: { allowed: false, used: 5, limit: 5, remaining: 0 }, error: null },
  });
  const result = await verifyAndCheckLimit(client, { accessToken: "good-token", action: "email_generation" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.match(result.error, /limit/i);
});

test("rejects with 500 when the usage RPC itself errors", async () => {
  const client = fakeClient({
    getUserResult: { data: { user: { id: "user-1" } }, error: null },
    rpcResult: { data: null, error: { message: "connection refused" } },
  });
  const result = await verifyAndCheckLimit(client, { accessToken: "good-token", action: "card_scan" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test api/_lib/verifyAndLimit.test.js`
Expected: FAIL — `Cannot find module './verifyAndLimit'`

- [ ] **Step 3: Write the implementation**

Create `api/_lib/verifyAndLimit.js`:

```js
const DAILY_LIMIT_ACTIONS = new Set(["email_generation", "card_scan"]);

async function verifyAndCheckLimit(client, { accessToken, action }) {
  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing Authorization token." };
  }

  const { data: userData, error: userErr } = await client.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
  const userId = userData.user.id;

  if (!DAILY_LIMIT_ACTIONS.has(action)) {
    return { ok: true, userId };
  }

  const { data, error } = await client.rpc("increment_ai_usage", { p_user_id: userId, p_action: action });
  if (error) {
    return { ok: false, status: 500, error: error.message };
  }
  if (!data.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Daily limit reached: ${data.limit} ${action === "email_generation" ? "email generations" : "card scans"} per day. Try again tomorrow.`,
    };
  }

  return { ok: true, userId };
}

module.exports = { verifyAndCheckLimit, DAILY_LIMIT_ACTIONS };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test api/_lib/verifyAndLimit.test.js`
Expected: PASS, 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/verifyAndLimit.js api/_lib/verifyAndLimit.test.js
git commit -m "feat: add server-side auth + daily-limit enforcement helper with tests"
```

---

### Task 4: Wire the helpers into `api/claude.js` and `server.js`

**Files:**
- Modify: `api/claude.js` (entire file rewritten)
- Modify: `server.js:32-56` (the `/api/claude` route)

**Interfaces:**
- Consumes: `isAllowedOrigin` from Task 2, `verifyAndCheckLimit` from Task 3.
- Produces: both endpoints now require `Authorization: Bearer <token>` and an `action` field in the JSON body; CORS is restricted to `ALLOWED_ORIGIN`. (The provider the request is forwarded to is unchanged in this plan — still Anthropic — the AI-provider-swap plan changes that separately, importing this same secured shape.)

- [ ] **Step 1: Rewrite `api/claude.js`**

Replace the full contents of `api/claude.js` with:

```js
const { createClient } = require("@supabase/supabase-js");
const { isAllowedOrigin } = require("./_lib/cors");
const { verifyAndCheckLimit } = require("./_lib/verifyAndLimit");

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin, process.env.ALLOWED_ORIGIN)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const { action, ...payload } = req.body;

  const supabase = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
  );

  const check = await verifyAndCheckLimit(supabase, { accessToken, action });
  if (!check.ok) {
    return res.status(check.status).json({ error: check.error });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2025-01-21",
      },
      body: JSON.stringify({ ...payload, model: "claude-haiku-4-5-20251001" }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
```

- [ ] **Step 2: Update `server.js`'s `/api/claude` route to match**

In `server.js`, replace lines 1-9 (the requires) with:

```js
const express = require("express");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { isAllowedOrigin } = require("./api/_lib/cors");
const { verifyAndCheckLimit } = require("./api/_lib/verifyAndLimit");
const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin, process.env.ALLOWED_ORIGIN)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  next();
});
app.use(express.json({ limit: "10mb" }));
```

(This drops the blanket `cors()` middleware and its `require("cors")` — replaced by the allow-list middleware above. Remove `const cors = require("cors")` and `app.use(cors());` if still present from the old file.)

Replace the existing `app.post("/api/claude", ...)` handler (originally lines 32-56) with:

```js
app.post("/api/claude", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const { action, ...payload } = req.body;

  const supabase = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
  );

  const check = await verifyAndCheckLimit(supabase, { accessToken, action });
  if (!check.ok) {
    return res.status(check.status).json({ error: check.error });
  }

  try {
    const payloadWithModel = { ...payload, model: "claude-haiku-4-5-20251001" };
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2025-01-21",
      },
      body: JSON.stringify(payloadWithModel),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Run the full unit suite**

Run: `npm test`
Expected: PASS — `api/_lib/cors.test.js` and `api/_lib/verifyAndLimit.test.js` still pass unchanged (this task only wired them into HTTP handlers, which aren't unit-tested here — see Task 5 for manual verification of the wiring).

- [ ] **Step 4: Commit**

```bash
git add api/claude.js server.js
git commit -m "feat: enforce auth + daily AI usage limit server-side, restrict CORS to allow-list"
```

---

### Task 5: Update the client to send the auth header and `action`, and remove the now-redundant client-side check

**Files:**
- Modify: `App.tsx:1-16` (the `callClaude` function)
- Modify: `App.tsx:46-53` (`checkAndIncrementUsage` — remove, no longer needed)
- Modify: `App.tsx:292-350` (`handleFile`, inside the `try` block that currently calls `checkAndIncrementUsage`)
- Modify: `App.tsx:481-495` (`openEmail`, which currently calls `checkAndIncrementUsage`)
- Modify: `App.tsx:686-698` (`sendBotMessage`, needs the `action: "chat"` field)

**Interfaces:**
- Consumes: nothing new (server enforces the limit now).
- Produces: `callClaude(messages, system, max_tokens, action)` — same name/shape as before plus one new required `action` parameter, so the AI-provider-swap plan (which renames this function) inherits the same signature.

**Why this task matters:** the server now enforces the daily limit via `increment_ai_usage` on every request. If the client *also* calls that RPC before hitting the proxy (as `checkAndIncrementUsage` does today), every real action would be double-counted — a user hits their 5-email cap after 2-3 actual emails. The client-side check must be removed, not just left in place alongside the server check.

- [ ] **Step 1: Update `callClaude` to send the auth header and `action`**

Replace `App.tsx` lines 1-16 with:

```tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import emailjs from "@emailjs/browser";

const CLAUDE_PROXY = "/api/claude";

async function callClaude(messages, system, max_tokens = 1000, action = "chat") {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(CLAUDE_PROXY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    },
    body: JSON.stringify({ max_tokens, system, messages, action }),
  });
  const d = await res.json();
  if (!res.ok || d.type === "error") throw new Error(d.error?.message || d.error || `API error ${res.status}`);
  return d.content?.[0]?.text || "";
}
```

- [ ] **Step 2: Remove `checkAndIncrementUsage`**

Delete `App.tsx` lines 46-53 (the entire `checkAndIncrementUsage` function) — it's replaced by server-side enforcement.

- [ ] **Step 3: Update `extractCard`'s call site to pass the action**

`extractCard` (originally lines 33-44) calls `callClaude` — update its call to:

```tsx
  const text = await callClaude([{
    role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: "Extract business card info as JSON." }
    ]
  }], sys, 1000, "card_scan");
```

- [ ] **Step 4: Remove the `checkAndIncrementUsage` call in `handleFile`**

In `handleFile` (originally around line 302-306), delete:

```tsx
        // Check daily card scan limit before calling Claude
        if (currentUser?.id) {
          await checkAndIncrementUsage(supabase, currentUser.id, "card_scan");
        }

```

The daily-limit error a user sees on a maxed-out day now comes from `extractCard`'s `callClaude` call throwing (caught by the existing `catch (err)` block in `handleFile`, which already sets `scanErr` from `err.message`) — no other change needed there.

- [ ] **Step 5: Update `genIntroEmail`'s call site and remove the check in `openEmail`**

`genIntroEmail` (originally lines 55-60) — update its `callClaude` call to:

```tsx
  return await callClaude([{
    role: "user",
    content: `Write a professional follow-up email from ${fromUser.name} (${fromUser.role} at ${fromUser.company}) to ${toContact.name} (${toContact.title || ""} at ${toContact.company || ""}). They just met at a networking event. Include a line about ${fromUser.company}: ${fromUser.bio || "innovative solutions in " + fromUser.sector}. Format: first line = Subject: ..., blank line, then email body. 3 short paragraphs max.`
  }], "You write professional, warm networking follow-up emails. Be concise.", 1000, "email_generation");
```

In `openEmail` (originally around lines 481-495), delete:

```tsx
      if (currentUser?.id) {
        await checkAndIncrementUsage(supabase, currentUser.id, "email_generation");
      }
```

The existing `catch (err)` in `openEmail` already surfaces `err.message` via `showToast`, so a maxed-out day still shows the right error — it just now comes from the server.

- [ ] **Step 6: Pass `"chat"` explicitly in `sendBotMessage`**

In `sendBotMessage` (originally lines 686-698), update the final call from:

```tsx
    const reply = await callClaude(newMessages.map(m => ({role:m.role, content:m.content})), sys, 700);
```

to:

```tsx
    const reply = await callClaude(newMessages.map(m => ({role:m.role, content:m.content})), sys, 700, "chat");
```

- [ ] **Step 7: Manual verification (no automated browser test harness exists in this project)**

This step can't be unit-tested — it requires a running app against a real Supabase project and the secured proxy from Task 4. Do this after Task 4 and this task are both deployed (locally via `server.js`, or on Vercel):

1. `curl -X POST http://localhost:3001/api/claude -H "Content-Type: application/json" -d '{"action":"chat","messages":[{"role":"user","content":"hi"}]}'` (no `Authorization` header) → expect HTTP 401.
2. Log into the app in a browser, open dev tools → Application → note the Supabase session's `access_token`. Re-run the same curl with `-H "Authorization: Bearer <token>"` → expect HTTP 200 with a real completion.
3. In the running app, scan business cards (or trigger email generation) past the daily cap (5 for email, 10 for card scan) → the 6th/11th attempt should show the "Daily limit reached" error, and this must happen on the **first** over-limit attempt, not after double the stated cap (confirms the double-counting bug from the old client-side check is gone).

- [ ] **Step 8: Commit**

```bash
git add App.tsx
git commit -m "feat: send auth token + action to the AI proxy, remove redundant client-side usage check"
```

---

### Task 6: Storage bucket + per-user policies in `schema.sql`

**Files:**
- Modify: `schema.sql` (append a new section)

**Interfaces:** none (pure SQL, no code interface).

- [ ] **Step 1: Append the bucket + policies**

Add to the end of `schema.sql`:

```sql
-- ── STORAGE: CARD IMAGES ───────────────────────────────────────────────────────
-- Bucket referenced by the app's business-card upload flow (App.tsx handleFile),
-- which stores files at "<user_id>/<timestamp>.<ext>". Public-read so the
-- generated public URL can be embedded in emails, but writes/deletes are
-- restricted to the owning user via the folder-prefix check below.
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', true)
on conflict (id) do nothing;

create policy "Anyone can view card images"
  on storage.objects for select
  using (bucket_id = 'card-images');

create policy "Users can upload their own card images"
  on storage.objects for insert
  with check (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own card images"
  on storage.objects for delete
  using (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

- [ ] **Step 2: Manual verification**

This is SQL against a live Supabase project — no local automated test. Run the appended block in the Supabase SQL editor (or the whole file, if setting up a fresh project), then verify:
1. `select * from storage.buckets where id = 'card-images';` returns one row with `public = true`.
2. In the app, scan a card while logged in as user A — the upload succeeds and the returned public URL loads the image in a plain browser tab (confirms public-read).
3. Using the Supabase JS client authenticated as user B, attempt `supabase.storage.from('card-images').upload('userA-id/test.jpg', ...)` using user A's known folder prefix — expect it to fail with a policy violation (confirms the insert policy is scoped correctly).

- [ ] **Step 3: Commit**

```bash
git add schema.sql
git commit -m "feat: add card-images storage bucket and per-user RLS policies"
```

## Notes for the executor

- Supabase Auth dashboard settings (enabling leaked-password protection, requiring email confirmation in production) are **not code changes** — no task above covers them because there's nothing to commit. Do them once, in the Supabase dashboard, before going live: Authentication → Providers → Email → toggle "Confirm email"; Authentication → Policies → enable leaked-password protection.
- This plan leaves the AI provider itself as Anthropic/Claude. The separate AI-provider-swap plan modifies `api/claude.js` further (renaming it and changing the upstream fetch) — it should be executed **after** this plan so it builds on the secured version rather than reintroducing the open-proxy bug.
