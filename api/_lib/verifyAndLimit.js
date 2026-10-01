const DAILY_LIMIT_ACTIONS = new Set(["email_generation", "card_scan", "email_send"]);

const LIMIT_LABELS = { email_generation: "email generations", card_scan: "card scans", email_send: "sent emails" };

async function verifyAndCheckLimit(client, { accessToken, action }) {
  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing Authorization token." };
  }

  // Dev bypass tokens are only honoured outside production
  const isDevToken = accessToken === "local-dev-token" || accessToken === "dev-token" || accessToken.startsWith("mock-");
  if (isDevToken) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, status: 401, error: "Invalid or expired session." };
    }
    return { ok: true, userId: "dev-user" };
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
    // Tolerate a database that hasn't run the latest migration yet
    if (error.message && (error.message.includes("function") || error.message.includes("schema cache") || error.message.includes("Unknown action") || error.message.includes("ai_usage_action_check"))) {
      console.warn(`Notice: usage limit for "${action}" unavailable (${error.message}). Proceeding without rate limit.`);
      return { ok: true, userId };
    }
    return { ok: false, status: 500, error: error.message };
  }
  if (!data?.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Daily limit reached: ${data.limit} ${LIMIT_LABELS[action] || action} per day. Try again tomorrow.`,
    };
  }

  return { ok: true, userId };
}

module.exports = { verifyAndCheckLimit, DAILY_LIMIT_ACTIONS };

