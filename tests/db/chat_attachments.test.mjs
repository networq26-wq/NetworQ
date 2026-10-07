import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const M = ["20261002_event_radar.sql", "20261005_connections_dedupe.sql", "20261003_account_email_events.sql", "20261006_realtime_notifications.sql",
           "20261008_nearby_radar.sql", "20261010_push_notifications.sql", "20261011_realtime_chat.sql", "20261012_chat_hardening.sql", "20261018_chat_attachments.sql"];
const rpc = async (h, u, fn, args = "", params = []) => (await h.as(u, `select ${fn}(${args}) as r`, params))[0].r;
const upload = (h, owner, path) => h.db.query("insert into storage.objects (bucket_id, name, owner) values ('chat-files', $1, $2)", [path, owner]);
const sendFile = async (h, u, to, path, name = "card.jpg", type = "image/jpeg", text = "", uploaded = true) => {
  if (uploaded) await upload(h, u, path);
  return rpc(h, u, "send_chat_message", "$1::uuid, null, $2, null, $3, $4, $5, $6", [to, text, path, name, type, 1234]);
};

async function setup() {
  const h = await createDb();
  // minimal Supabase Storage table so the "was it really uploaded?" check runs
  await h.db.exec("create schema if not exists storage; create table storage.objects (bucket_id text, name text, owner uuid);");
  for (const m of M) await h.db.exec((await import("node:fs")).readFileSync(new URL(`../../supabase/migrations/${m}`, import.meta.url), "utf8"));
  const a = await h.addUser("Asha Rao"), b = await h.addUser("Bob Iyer"), c = await h.addUser("Cara Nair");
  const ev = await rpc(h, a, "create_event", "'Founders Night', null, null, null");
  await rpc(h, b, "join_event_by_code", `'${ev.join_code}'`);
  const r = await rpc(h, a, "send_connection_request", `'${ev.id}', '${b}'`);
  await rpc(h, b, "respond_connection_request", `'${r.id}', true`);
  const chat = await rpc(h, a, "get_or_create_direct_chat", `'${b}'`);
  return { h, a, b, c, ev, chat };
}

test("a photo-only message is allowed, previews as '📷 Photo' in the list and the notification", async () => {
  const { h, a, b, chat } = await setup();
  const m = await sendFile(h, a, b, `${chat}/abc-card.jpg`);
  assert.equal(m.attachment_path, `${chat}/abc-card.jpg`);
  assert.equal(m.content, "");
  const list = await rpc(h, b, "my_direct_chats");
  assert.equal(list[0].last_message, "📷 Photo");
  const n = await h.as(b, "select body from notifications where dedupe_key = $1", [`chat:${chat}`]);
  assert.equal(n[0].body, "📷 Photo");
});

test("a file must live in THIS chat's folder; no path tricks; event rooms can't carry files", async () => {
  const { h, a, b, c, ev, chat } = await setup();
  await assert.rejects(sendFile(h, a, b, `00000000-0000-0000-0000-000000000000/x.pdf`, "x.pdf", "application/pdf"), /invalid_attachment/);
  await assert.rejects(sendFile(h, a, b, `${chat}/../other/x.pdf`, "x.pdf", "application/pdf"), /invalid_attachment/);
  await assert.rejects(rpc(h, a, "send_chat_message", "null, $1::uuid, '', null, $2, 'x.pdf', 'application/pdf', 10", [ev.id, `${chat}/x.pdf`]), /attachments_direct_only/);
  await assert.rejects(sendFile(h, a, b, `${chat}/never-uploaded.pdf`, "n.pdf", "application/pdf", "", false), /invalid_attachment/, "must really be uploaded");
  await upload(h, b, `${chat}/bobs.pdf`);
  await assert.rejects(rpc(h, a, "send_chat_message", "$1::uuid, null, '', null, $2, 'bobs.pdf', 'application/pdf', 10", [b, `${chat}/bobs.pdf`]), /invalid_attachment/, "can't send someone else's upload");
  const doc = await sendFile(h, a, b, `${chat}/deck.pdf`, "deck.pdf", "application/pdf", "Our deck");
  assert.equal(doc.content, "Our deck");
  const list = await rpc(h, b, "my_direct_chats");
  assert.equal(list[0].last_message, "Our deck");
  await assert.rejects(rpc(h, a, "send_chat_message", "$1::uuid, null, '   '", [b]), /empty_message/);
});

test("only the two people in the chat pass the storage check", async () => {
  const { h, a, b, c, chat } = await setup();
  const allowed = async (u) => (await h.as(u, "select chat_file_allowed($1) as ok", [`${chat}/file.jpg`]))[0].ok;
  assert.equal(await allowed(a), true);
  assert.equal(await allowed(b), true);
  assert.equal(await allowed(c), false);
  await rpc(h, b, "block_user", `'${a}'`);
  assert.equal(await allowed(a), false, "a block cuts file access too");
  assert.equal((await h.as(a, "select chat_file_allowed('not-a-uuid/x') as ok"))[0].ok, false);
});

test("old 4-argument calls (cached app versions) still work", async () => {
  const { h, a, b } = await setup();
  const m = await rpc(h, a, "send_chat_message", "$1::uuid, null, 'hello'", [b]);
  assert.equal(m.content, "hello");
});
