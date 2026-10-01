// HMAC-signed, expiring tokens for one-click email links ("secure my account", "cancel deletion").
const crypto = require("crypto");

function sign(payload, ttlSeconds, secret) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token, action, secret) {
  if (typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  let given;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.a !== action || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Dedicated secret if configured; otherwise derived from the service key (never shipped to clients)
function linkSecret() {
  if (process.env.LINK_SIGNING_SECRET) return process.env.LINK_SIGNING_SECRET;
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) return null;
  return crypto.createHash("sha256").update(`networq-links:${base}`).digest("hex");
}

module.exports = { sign, verify, linkSecret };
