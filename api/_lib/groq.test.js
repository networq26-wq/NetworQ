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

