const VISION_MODEL = "llama-3.2-11b-vision-preview";
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

