# AI Provider Swap (Claude → Groq) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all three Claude call sites (business-card OCR, follow-up email drafting, chat assistant) with open-source models hosted on Groq, with no change in user-visible behavior.

**Architecture:** Groq's API is OpenAI-compatible chat completions, not Anthropic's Messages API — different message/image shape and response shape. Rather than adding a translation layer, the client builds OpenAI-shaped messages directly (there's only one provider now, so an abstraction layer would be premature). A small pure module (`api/_lib/groq.js`) owns model selection (vision model for card scans, text model otherwise) and response-text extraction, unit-tested without any network calls. The proxy itself (`api/claude.js` → renamed `api/ai.js`) keeps the auth/rate-limit gate added by the security-hardening plan and only swaps its upstream fetch target.

**Tech Stack:** Groq's OpenAI-compatible endpoint (`https://api.groq.com/openai/v1/chat/completions`), `meta-llama/llama-4-scout-17b-16e-instruct` (vision) and `llama-3.3-70b-versatile` (text) — both open-weight models.

**Spec:** `docs/superpowers/specs/2026-08-27-premium-relaunch-design.md`, section 3.

## Global Constraints

- **Depends on the security-hardening plan being implemented first** — this plan edits the same proxy file and assumes it already requires `Authorization` + `action` (added there). Executing this plan against the pre-hardening `api/claude.js` would silently reintroduce the open-proxy vulnerability.
- `GROQ_API_KEY` is server-side only, never `EXPO_PUBLIC_*`.
- No remaining reference to `ANTHROPIC_API_KEY` or `api/claude.js` anywhere in the codebase once this plan is done.
- User-visible behavior is unchanged: same "click a photo → form fills in," same email-draft format, same chat UI.

---

### Task 1: `api/_lib/groq.js` — request-building and response-parsing helpers

**Files:**
- Create: `api/_lib/groq.js`
- Test: `api/_lib/groq.test.js`

**Interfaces:**
- Produces: `buildGroqRequestBody({ system, messages, max_tokens, action })` → `{ model, max_tokens, messages }`. `extractGroqText(responseJson)` → `string`.

- [ ] **Step 1: Write the failing test**

Create `api/_lib/groq.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildGroqRequestBody, extractGroqText, VISION_MODEL, TEXT_MODEL } = require("./groq");

test("uses the vision model for card_scan", () => {
  const body = buildGroqRequestBody({ system: "sys", messages: [{ role: "user", content: "hi" }], max_tokens: 500, action: "card_scan" });
  assert.equal(body.model, VISION_MODEL);
});

test("uses the text model for email_generation and chat", () => {
  const emailBody = buildGroqRequestBody({ system: "sys", messages: [], max_tokens: 500, action: "email_generation" });
  const chatBody = buildGroqRequestBody({ system: "sys", messages: [], max_tokens: 500, action: "chat" });
  assert.equal(emailBody.model, TEXT_MODEL);
  assert.equal(chatBody.model, TEXT_MODEL);
});

test("prepends the system prompt as a system message", () => {
  const body = buildGroqRequestBody({ system: "You are helpful.", messages: [{ role: "user", content: "hi" }], max_tokens: 500, action: "chat" });
  assert.deepEqual(body.messages[0], { role: "system", content: "You are helpful." });
  assert.deepEqual(body.messages[1], { role: "user", content: "hi" });
});

test("omits the system message entirely when none is given", () => {
  const body = buildGroqRequestBody({ system: "", messages: [{ role: "user", content: "hi" }], max_tokens: 500, action: "chat" });
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");
});

test("carries max_tokens through unchanged", () => {
  const body = buildGroqRequestBody({ system: "sys", messages: [], max_tokens: 777, action: "chat" });
  assert.equal(body.max_tokens, 777);
});

test("extractGroqText reads the first choice's message content", () => {
  const text = extractGroqText({ choices: [{ message: { role: "assistant", content: "Hello there" } }] });
  assert.equal(text, "Hello there");
});

test("extractGroqText returns an empty string when the shape is missing", () => {
  assert.equal(extractGroqText({}), "");
  assert.equal(extractGroqText({ choices: [] }), "");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test api/_lib/groq.test.js`
Expected: FAIL — `Cannot find module './groq'`

- [ ] **Step 3: Write the implementation**

Create `api/_lib/groq.js`:

```js
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const TEXT_MODEL = "llama-3.3-70b-versatile";

function buildGroqRequestBody({ system, messages, max_tokens, action }) {
  const model = action === "card_scan" ? VISION_MODEL : TEXT_MODEL;
  const fullMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  return { model, max_tokens, messages: fullMessages };
}

function extractGroqText(responseJson) {
  return responseJson?.choices?.[0]?.message?.content || "";
}

module.exports = { buildGroqRequestBody, extractGroqText, VISION_MODEL, TEXT_MODEL };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test api/_lib/groq.test.js`
Expected: PASS, 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/groq.js api/_lib/groq.test.js
git commit -m "feat: add Groq request/response helpers with model-selection tests"
```

---

### Task 2: Replace `api/claude.js` with `api/ai.js`

**Files:**
- Create: `api/ai.js`
- Delete: `api/claude.js`

**Interfaces:**
- Consumes: `isAllowedOrigin` (`api/_lib/cors.js`), `verifyAndCheckLimit` (`api/_lib/verifyAndLimit.js`) — both from the security-hardening plan — and `buildGroqRequestBody` from Task 1.

- [ ] **Step 1: Create `api/ai.js`**

```js
const { createClient } = require("@supabase/supabase-js");
const { isAllowedOrigin } = require("./_lib/cors");
const { verifyAndCheckLimit } = require("./_lib/verifyAndLimit");
const { buildGroqRequestBody } = require("./_lib/groq");

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
  const { action, system, messages, max_tokens } = req.body;

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
    const body = buildGroqRequestBody({ system, messages, max_tokens, action });
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
```

- [ ] **Step 2: Delete the old file**

```bash
git rm api/claude.js
```

- [ ] **Step 3: Commit**

```bash
git add api/ai.js
git commit -m "feat: replace Anthropic proxy with Groq proxy at api/ai.js"
```

---

### Task 3: Update `server.js`'s local-dev route to match

**Files:**
- Modify: `server.js` (the `/api/claude` route added by the security-hardening plan)

**Interfaces:** none new.

- [ ] **Step 1: Replace the route**

Change the route path from `/api/claude` to `/api/ai`, and swap the require + upstream call to use the Groq helper. Replace the `app.post("/api/claude", ...)` block with:

```js
const { buildGroqRequestBody } = require("./api/_lib/groq");

app.post("/api/ai", async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set on the server." });
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const { action, system, messages, max_tokens } = req.body;

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
    const body = buildGroqRequestBody({ system, messages, max_tokens, action });
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

(Add the `const { buildGroqRequestBody } = require("./api/_lib/groq");` line near the top with the other requires, not inline.)

- [ ] **Step 2: Commit**

```bash
git add server.js
git commit -m "feat: point local dev proxy at Groq instead of Anthropic"
```

---

### Task 4: Update the client — rename `callClaude` to `callAI`, point at `/api/ai`, switch image shape

**Files:**
- Modify: `App.tsx` (the `CLAUDE_PROXY` constant and `callClaude` function — as left by the security-hardening plan's Task 5)
- Modify: `App.tsx` (`extractCard`'s image content block)

**Interfaces:**
- Produces: `callAI(messages, system, max_tokens, action)` — same signature as the old `callClaude`, renamed. All call sites (`extractCard`, `genIntroEmail`, `sendBotMessage`) updated to the new name.

- [ ] **Step 1: Rename the proxy constant and function**

The security-hardening plan leaves `App.tsx` starting with:

```tsx
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

Replace it with:

```tsx
const AI_PROXY = "/api/ai";

async function callAI(messages, system, max_tokens = 1000, action = "chat") {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(AI_PROXY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    },
    body: JSON.stringify({ max_tokens, system, messages, action }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(typeof d.error === "string" ? d.error : d.error?.message || `API error ${res.status}`);
  return d.choices?.[0]?.message?.content || "";
}
```

- [ ] **Step 2: Update `extractCard`'s image block and call**

Replace:

```tsx
async function extractCard(base64, mediaType) {
  const sys = `Extract business card info. Return ONLY JSON:
{"name":string,"title":string,"company":string,"email":string,"phone":string,"website":string,"linkedin":string}
Use null for missing fields.`;
  const text = await callClaude([{
    role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: "Extract business card info as JSON." }
    ]
  }], sys, 1000, "card_scan");
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { return null; }
}
```

with:

```tsx
async function extractCard(base64, mediaType) {
  const sys = `Extract business card info. Return ONLY JSON:
{"name":string,"title":string,"company":string,"email":string,"phone":string,"website":string,"linkedin":string}
Use null for missing fields.`;
  const text = await callAI([{
    role: "user", content: [
      { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
      { type: "text", text: "Extract business card info as JSON." }
    ]
  }], sys, 1000, "card_scan");
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { return null; }
}
```

- [ ] **Step 3: Update the remaining two call sites' function name**

In `genIntroEmail`, change `callClaude(` to `callAI(` (arguments unchanged — it already passes `"email_generation"` from the security-hardening plan).

In `sendBotMessage`, change `callClaude(` to `callAI(` (arguments unchanged — it already passes `"chat"`).

- [ ] **Step 4: Manual verification (no automated browser test harness exists in this project)**

Requires a real `GROQ_API_KEY` and a running proxy (local `server.js` or deployed):
1. Scan a real business-card photo in the app → the add-contact form should auto-fill with plausible extracted fields (confirms the vision model + `image_url` shape work end-to-end).
2. Open a contact and click "Send Intro Email" → a draft should generate in the expected `Subject: ...` + body format (confirms the text model + system-prompt handling).
3. Open the AI chat assistant and ask a question about your contacts → should get a relevant reply (confirms `action: "chat"` bypasses the daily cap but still requires auth from the security plan).
4. `grep -ri "anthropic\|claude" App.tsx api/ server.js` → expect no remaining matches (aside from this plan's own git history), confirming the swap is complete.

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "feat: switch client AI calls from Claude to Groq (callAI, /api/ai, image_url shape)"
```
