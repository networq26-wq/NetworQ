// Data access for the admin panel. createSupabaseStore talks to Supabase with the service role;
// createMemoryStore has the same methods for tests and local previews.
const { randomUUID } = require("crypto");

const SIGNUP_FIELDS = new Set(["status", "invited_at", "joined_at", "notes", "tags", "notified", "email_error", "email_attempts", "last_emailed_at"]);
const clean = (patch) => Object.fromEntries(Object.entries(patch).filter(([k]) => SIGNUP_FIELDS.has(k)));

function createSupabaseStore(sb) {
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    async listSignups() {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const page = must(await sb.from("waitlist").select("*").order("created_at", { ascending: false }).range(from, from + 999));
        all.push(...page);
        if (page.length < 1000) return all;
      }
    },
    async getSignup(id) {
      return must(await sb.from("waitlist").select("*").eq("id", id).maybeSingle());
    },
    async updateSignups(ids, patch) {
      if (!ids.length) return [];
      return must(await sb.from("waitlist").update(clean(patch)).in("id", ids).select("*"));
    },
    async deleteSignups(ids) {
      if (!ids.length) return 0;
      return must(await sb.from("waitlist").delete().in("id", ids).select("id")).length;
    },
    async syncJoined() {
      const { data, error } = await sb.rpc("admin_waitlist_sync_joined");
      return error ? null : data;
    },
    async appStats() {
      const { data, error } = await sb.rpc("admin_app_stats");
      if (error) throw new Error(error.message);
      return data;
    },
    async listAdmins() {
      return must(await sb.from("admin_users").select("id, username, created_by, created_at, disabled_at, last_login_at").order("created_at"));
    },
    async findAdmin(username) {
      return must(await sb.from("admin_users").select("*").eq("username", username).maybeSingle());
    },
    async createAdmin(row) {
      return must(await sb.from("admin_users").insert(row).select("id, username").single());
    },
    async setAdminDisabled(id, disabled) {
      must(await sb.from("admin_users").update({ disabled_at: disabled ? new Date().toISOString() : null }).eq("id", id));
    },
    async touchAdmin(id) {
      await sb.from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", id);
    },
    async audit(entry) {
      await sb.from("admin_audit").insert(entry).then(() => {}, () => {});
    },
    async listAudit(limit = 200) {
      return must(await sb.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(limit));
    },
    // Safety: reports of messages, people and AI answers (content_reports), with names for both sides
    async listReports(limit = 300) {
      const rows = must(await sb.from("content_reports").select("*").order("created_at", { ascending: false }).limit(limit));
      const ids = [...new Set(rows.flatMap((r) => [r.reporter, r.target_user]).filter(Boolean))];
      const names = new Map();
      if (ids.length) for (const p of must(await sb.from("profiles").select("id, name").in("id", ids))) names.set(p.id, p.name);
      return rows.map((r) => ({ ...r, reporter_name: names.get(r.reporter) || null, target_name: names.get(r.target_user) || null }));
    },
    async updateReport(id, patch) {
      const allowed = Object.fromEntries(Object.entries(patch).filter(([k]) => ["status", "admin_note", "handled_by", "handled_at"].includes(k)));
      return must(await sb.from("content_reports").update(allowed).eq("id", id).select("id").maybeSingle());
    },
  };
}

function createMemoryStore({ signups = [], admins = [], stats = {}, users = [], reports = [] } = {}) {
  const s = { signups: signups.map((r) => ({ tags: [], status: "waiting", ...r })), admins: [...admins], auditLog: [], stats, users, reports: reports.map((r) => ({ status: "open", ...r })) };
  return {
    _state: s,
    async listSignups() {
      return [...s.signups].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },
    async getSignup(id) {
      return s.signups.find((r) => r.id === id) || null;
    },
    async updateSignups(ids, patch) {
      const hit = s.signups.filter((r) => ids.includes(r.id));
      hit.forEach((r) => Object.assign(r, clean(patch)));
      return hit;
    },
    async deleteSignups(ids) {
      const before = s.signups.length;
      s.signups = s.signups.filter((r) => !ids.includes(r.id));
      return before - s.signups.length;
    },
    async syncJoined() {
      let n = 0;
      for (const r of s.signups) {
        if (r.status !== "joined" && s.users.includes(r.email)) {
          r.status = "joined";
          r.joined_at = r.joined_at || new Date().toISOString();
          n++;
        }
      }
      return n;
    },
    async appStats() {
      return s.stats;
    },
    async listAdmins() {
      return s.admins.map(({ password_hash, ...a }) => a);
    },
    async findAdmin(username) {
      return s.admins.find((a) => a.username === username) || null;
    },
    async createAdmin(row) {
      if (s.admins.some((a) => a.username === row.username)) throw new Error("duplicate key value violates unique constraint");
      const a = { id: randomUUID(), created_at: new Date().toISOString(), disabled_at: null, last_login_at: null, ...row };
      s.admins.push(a);
      return { id: a.id, username: a.username };
    },
    async setAdminDisabled(id, disabled) {
      const a = s.admins.find((x) => x.id === id);
      if (a) a.disabled_at = disabled ? new Date().toISOString() : null;
    },
    async touchAdmin(id) {
      const a = s.admins.find((x) => x.id === id);
      if (a) a.last_login_at = new Date().toISOString();
    },
    async audit(entry) {
      s.auditLog.unshift({ id: s.auditLog.length + 1, created_at: new Date().toISOString(), ...entry });
    },
    async listAudit(limit = 200) {
      return s.auditLog.slice(0, limit);
    },
    async listReports(limit = 300) {
      return [...s.reports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
    },
    async updateReport(id, patch) {
      const r = s.reports.find((x) => x.id === id);
      if (!r) return null;
      for (const k of ["status", "admin_note", "handled_by", "handled_at"]) if (k in patch) r[k] = patch[k];
      return { id };
    },
  };
}

module.exports = { createSupabaseStore, createMemoryStore };
