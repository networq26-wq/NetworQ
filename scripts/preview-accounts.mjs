#!/usr/bin/env node
// Creates (or resets) two confirmed preview accounts for testing in the device preview.
//   node scripts/preview-accounts.mjs          create / reset
//   node scripts/preview-accounts.mjs --delete remove them and their data
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
}
const admin = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PASSWORD = "Preview#2026";
const ACCOUNTS = [
  { email: "preview.a@networq.co.in", name: "Preview Asha", company: "NetworQ QA", role: "Founder", phone: "+91 90000 00001", linkedin: "linkedin.com/in/preview-asha" },
  { email: "preview.b@networq.co.in", name: "Preview Bob", company: "NetworQ QA", role: "Investor", phone: "+91 90000 00002", linkedin: "linkedin.com/in/preview-bob" },
];

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const acc of ACCOUNTS) {
  const existing = list.users.find((u) => u.email === acc.email);
  if (process.argv.includes("--delete")) {
    if (existing) await admin.auth.admin.deleteUser(existing.id);
    console.log("deleted", acc.email);
    continue;
  }
  let id = existing?.id;
  if (id) await admin.auth.admin.updateUserById(id, { password: PASSWORD, email_confirm: true });
  else {
    const { data, error } = await admin.auth.admin.createUser({ email: acc.email, password: PASSWORD, email_confirm: true, user_metadata: { preview_account: true } });
    if (error) throw error;
    id = data.user.id;
  }
  const { error } = await admin.from("profiles").upsert({ id, name: acc.name, company: acc.company, role: acc.role, phone: acc.phone, linkedin: acc.linkedin, sector: "Technology" });
  if (error) throw error;
  console.log(`✔ ${acc.email}  /  ${PASSWORD}   (${acc.name})`);
}
