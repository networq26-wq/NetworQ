const test = require("node:test");
const assert = require("node:assert/strict");
const { createPushSender } = require("../../api/_lib/push");

test("Expo tokens go to the Expo push API in one batch; DeviceNotRegistered marks the token dead", async () => {
  const calls = [];
  const sender = createPushSender({
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }] }));
    },
  });
  const r = await sender.send(
    [{ token: "ExponentPushToken[a]", platform: "android" }, { token: "ExponentPushToken[b]", platform: "android" }, { token: "junk", platform: "android" }],
    { title: "Hi", body: "There", url: "https://app.test/?open=radar", data: { screen: "radar" } }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://exp.host/--/api/v2/push/send");
  assert.deepEqual(calls[0].body.map((m) => m.to), ["ExponentPushToken[a]", "ExponentPushToken[b]"], "malformed tokens are never sent");
  assert.equal(calls[0].body[0].data.url, "https://app.test/?open=radar");
  assert.equal(calls[0].body[0].channelId, "default");
  assert.deepEqual(r, { delivered: 1, dead: ["ExponentPushToken[b]"] });
});

test("web subscriptions use Web Push; 404/410 means the browser unsubscribed", async () => {
  const sent = [];
  const webpush = {
    setVapidDetails: () => {},
    sendNotification: async (sub, payload) => {
      if (sub.endpoint.includes("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      sent.push(JSON.parse(payload));
    },
  };
  const sender = createPushSender({ webpush, vapid: { publicKey: "pub", privateKey: "priv" }, fetchImpl: async () => new Response("{}") });
  const r = await sender.send(
    [{ token: "https://push.test/1", platform: "web", subscription: { endpoint: "https://push.test/1", keys: {} } }, { token: "https://push.test/gone", platform: "web", subscription: { endpoint: "https://push.test/gone", keys: {} } }],
    { title: "Hi", body: "B", url: "/x" }
  );
  assert.deepEqual(sent, [{ title: "Hi", body: "B", url: "/x", data: {} }]);
  assert.deepEqual(r, { delivered: 1, dead: ["https://push.test/gone"] });
});

test("without VAPID keys, web subscriptions are skipped (not crashed)", async () => {
  const sender = createPushSender({ webpush: { setVapidDetails() {}, sendNotification: async () => assert.fail("must not send") }, vapid: {}, fetchImpl: async () => new Response("{}") });
  assert.equal(sender.webReady, false);
  assert.deepEqual(await sender.send([{ token: "https://p/1", platform: "web", subscription: { endpoint: "https://p/1" } }], { title: "x" }), { delivered: 0, dead: [] });
});
