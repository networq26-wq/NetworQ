const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verifyAndCheckLimit } = require("./verifyAndLimit");

function fakeClient({ getUserResult, rpcResult }) {
  return {
    auth: { getUser: async () => getUserResult },
    rpc: async () => rpcResult,
  };
}

test("rejects when accessToken is missing", async () => {
  const client = fakeClient({ getUserResult: { data: { user: null }, error: null }, rpcResult: {} });
  const result = await verifyAndCheckLimit(client, { accessToken: "", action: "card_scan" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("rejects an invalid/expired token", async () => {
  const client = fakeClient({
    getUserResult: { data: { user: null }, error: { message: "invalid JWT" } },
    rpcResult: {},
  });
  const result = await verifyAndCheckLimit(client, { accessToken: "bad-token", action: "card_scan" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("allows a chat request with a valid token and never calls the usage RPC", async () => {
  let rpcCalled = false;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: async () => { rpcCalled = true; return { data: null, error: null }; },
  };
  const result = await verifyAndCheckLimit(client, { accessToken: "good-token", action: "chat" });
  assert.equal(result.ok, true);
  assert.equal(result.userId, "user-1");
  assert.equal(rpcCalled, false);
});

test("allows a card_scan request when the usage RPC reports allowed:true", async () => {
  const client = fakeClient({
    getUserResult: { data: { user: { id: "user-1" } }, error: null },
    rpcResult: { data: { allowed: true, used: 3, limit: 10, remaining: 7 }, error: null },
  });
  const result = await verifyAndCheckLimit(client, { accessToken: "good-token", action: "card_scan" });
  assert.equal(result.ok, true);
  assert.equal(result.userId, "user-1");
});

test("rejects with 429 when the usage RPC reports allowed:false", async () => {
  const client = fakeClient({
    getUserResult: { data: { user: { id: "user-1" } }, error: null },
    rpcResult: { data: { allowed: false, used: 5, limit: 5, remaining: 0 }, error: null },
  });
  const result = await verifyAndCheckLimit(client, { accessToken: "good-token", action: "email_generation" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.match(result.error, /limit/i);
});

test("rejects with 500 when the usage RPC itself errors", async () => {
  const client = fakeClient({
    getUserResult: { data: { user: { id: "user-1" } }, error: null },
    rpcResult: { data: null, error: { message: "connection refused" } },
  });
  const result = await verifyAndCheckLimit(client, { accessToken: "good-token", action: "card_scan" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
});

