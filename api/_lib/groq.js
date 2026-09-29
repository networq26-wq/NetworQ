const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const TEXT_MODEL = "qwen/qwen3.8-27b";

function buildGroqRequestBody({ system, messages, max_tokens, action }) {
  const model = action === "card_scan" ? VISION_MODEL : TEXT_MODEL;
  const fullMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  return { model, max_tokens, messages: fullMessages };
}

function extractGroqText(responseJson) {
  return responseJson?.choices?.[0]?.message?.content || "";
}

module.exports = { buildGroqRequestBody, extractGroqText, VISION_MODEL, TEXT_MODEL };

