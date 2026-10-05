/**
 * Push delivery.
 *   • Android app: Expo push service (free; it relays to Firebase Cloud Messaging using the
 *     FCM key uploaded to the Expo project — the key never lives on this server).
 *   • Browsers: Web Push with VAPID keys (open standard, no third-party account).
 * Dead tokens (uninstalled app, revoked browser permission) are reported back for removal.
 */
const EXPO_URL = "https://exp.host/--/api/v2/push/send";

function createPushSender({ fetchImpl = fetch, webpush = null, vapid = null, expoAccessToken = null } = {}) {
  if (webpush && vapid?.publicKey && vapid?.privateKey) {
    webpush.setVapidDetails(vapid.subject || "mailto:support@networq.co.in", vapid.publicKey, vapid.privateKey);
  }
  const webReady = !!(webpush && vapid?.publicKey && vapid?.privateKey);

  // message: { title, body, data, url, ttl? (seconds; calls use 60) }
  async function send(tokens, message) {
    const dead = [];
    let delivered = 0;

    const expo = tokens.filter((t) => t.platform !== "web" && /^Expo(nent)?PushToken\[/.test(t.token));
    for (let i = 0; i < expo.length; i += 100) {
      const batch = expo.slice(i, i + 100);
      try {
        const res = await fetchImpl(EXPO_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", ...(expoAccessToken ? { Authorization: `Bearer ${expoAccessToken}` } : {}) },
          body: JSON.stringify(
            batch.map((t) => ({ to: t.token, title: message.title, body: message.body || undefined, data: { ...(message.data || {}), url: message.url }, sound: "default", priority: "high", channelId: "default", ...(message.ttl ? { ttl: message.ttl } : {}) }))
          ),
          signal: AbortSignal.timeout(10000),
        });
        const json = await res.json().catch(() => ({}));
        (json.data || []).forEach((ticket, j) => {
          if (ticket.status === "ok") delivered++;
          else if (ticket.details?.error === "DeviceNotRegistered") dead.push(batch[j].token);
        });
      } catch (err) {
        console.warn("[Push] Expo send failed:", err.message);
      }
    }

    const web = tokens.filter((t) => t.platform === "web" && t.subscription?.endpoint);
    if (web.length && webReady) {
      const payload = JSON.stringify({ title: message.title, body: message.body || "", url: message.url || "/", data: message.data || {} });
      await Promise.all(
        web.map(async (t) => {
          try {
            await webpush.sendNotification(t.subscription, payload, { TTL: message.ttl || 24 * 3600, urgency: "high" });
            delivered++;
          } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) dead.push(t.token);
            else console.warn("[Push] Web push failed:", err.statusCode || err.message);
          }
        })
      );
    }
    return { delivered, dead };
  }

  return { send, webReady };
}

function productionPushSender() {
  let webpush = null;
  try {
    webpush = require("web-push");
  } catch {}
  return createPushSender({
    webpush,
    vapid: { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT },
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN || null,
  });
}

module.exports = { createPushSender, productionPushSender };
