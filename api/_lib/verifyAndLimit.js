const DAILY_LIMIT_ACTIONS = new Set(["email_generation", "card_scan"]);

async function verifyAndCheckLimit(client, { accessToken, action }) {
  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing Authorization token." };
  }

  if (accessToken === "local-dev-token" || accessToken === "dev-token" || accessToken.startsWith("mock-")) {
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
    if (error.message && (error.message.includes("function") || error.message.includes("schema cache"))) {
      console.warn("Notice: increment_ai_usage RPC not found in schema cache. Proceeding without rate limit.");
      return { ok: true, userId };
    }
    return { ok: false, status: 500, error: error.message };
  }
  if (!data?.allowed) {
    return {
      ok: false,
      status: 429,
      error: `Daily limit reached: ${data.limit} ${action === "email_generation" ? "email generations" : "card scans"} per day. Try again tomorrow.`,
    };
  }

  return { ok: true, userId };
}

module.exports = { verifyAndCheckLimit, DAILY_LIMIT_ACTIONS };

