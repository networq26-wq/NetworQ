// Groq retired its Llama vision models; Qwen 3.8 handles images (verified on a business card)
const VISION_MODEL = "qwen/qwen3.8-27b";
const TEXT_MODEL = "qwen/qwen3.8-27b";

function buildGroqRequestBody({ system, messages, max_tokens, action }) {
  const model = action === "card_scan" ? VISION_MODEL : TEXT_MODEL;
  const fullMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  return { model, max_tokens, messages: fullMessages };
}

function extractGroqText(responseJson) {
  return responseJson?.choices?.[0]?.message?.content || "";
}

// Used when Groq reports model_not_found for the primary model
const FALLBACK_MODEL = "openai/gpt-oss-120b";

module.exports = { buildGroqRequestBody, extractGroqText, VISION_MODEL, TEXT_MODEL, FALLBACK_MODEL };

