// In-memory stand-in for Supabase Auth (GoTrue) + PostgREST, served through
// Playwright request interception. Emulates row-level security per user so
// multi-user isolation can be tested without touching a real project.
import { randomUUID } from "crypto";
import type { BrowserContext, Route, Request } from "@playwright/test";

type Row = Record<string, any>;

interface MockUser {
  id: string;
  email: string;
  password: string;
  confirmed: boolean;
  user_metadata: Record<string, any>;
  created_at: string;
}

const OWNER_COLUMN: Record<string, string> = { profiles: "id" };
const b64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");

interface RadarEventRow { id: string; external_id: string | null; name: string; venue: string | null; starts_at: string | null; join_code: string | null; source: "listed" | "user"; created_by: string }
interface AttendeeRow { event_id: string; user_id: string; last_seen_at: number; radar_on: boolean; visible: boolean; show_distance: boolean; show_profile: boolean }
interface TokenRow { token: string; user_id: string; event_id: string; expires_at: number }
interface RequestRow { id: string; event_id: string; from_user: string; to_user: string; status: "pending" | "accepted" | "declined" | "cancelled"; created_at: string }

class RpcError extends Error {}

export class MockSupabase {
  // Event Radar state (mirrors supabase/migrations/20261002_event_radar.sql; the SQL itself is tested in tests/db)
  events: RadarEventRow[] = [];
  attendees: AttendeeRow[] = [];
  tokens: TokenRow[] = [];
  requests: RequestRow[] = [];
  blocks: { blocker: string; blocked: string }[] = [];

  private notify(user: string, type: string, title: string, body: string, data: Record<string, unknown>) {
    this.table("notifications").unshift({ id: randomUUID(), user_id: user, type, title, body, data, read_at: null, created_at: new Date().toISOString() });
  }
  private isBlocked(a: string, b: string) {
    return this.blocks.some((x) => (x.blocker === a && x.blocked === b) || (x.blocker === b && x.blocked === a));
  }
  users: MockUser[] = [];
  tables: Record<string, Row[]> = {};
  autoConfirm = true;
  failNext: { method?: string; table?: string } | null = null;
  uploads: string[] = [];

  addPublicEvent(e: Partial<Record<string, any>> & { title: string; starts_at: string; url: string }) {
    const row = { id: randomUUID(), ends_at: null, venue: null, city: null, image: null, description: null, organizer: null, verified: false, source_host: new URL(e.url).hostname, created_at: new Date().toISOString(), ...e };
    this.table("public_events").push(row);
    return row;
  }
  sessionsRevoked = 0;
  private refreshTokens = new Map<string, string>();

  addUser(email: string, password: string, opts: { confirmed?: boolean; profile?: Row; metadata?: Row } = {}) {
    const user: MockUser = {
      id: randomUUID(),
      email,
      password,
      confirmed: opts.confirmed ?? true,
      user_metadata: opts.metadata || {},
      created_at: new Date().toISOString(),
    };
    this.users.push(user);
    if (opts.profile) this.table("profiles").push({ id: user.id, ...opts.profile });
    return user;
  }

  table(name: string) {
    return (this.tables[name] ||= []);
  }

  rowsOwnedBy(table: string, userId: string) {
    const col = OWNER_COLUMN[table] || "user_id";
    return this.table(table).filter((r) => r[col] === userId);
  }

  // ── Auth helpers ───────────────────────────────────────────────────────────
  private publicUser(u: MockUser) {
    return {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: u.email,
      email_confirmed_at: u.confirmed ? u.created_at : null,
      user_metadata: u.user_metadata,
      app_metadata: { provider: "email", providers: ["email"] },
      identities: [{ id: u.id, user_id: u.id, provider: "email", identity_data: { email: u.email } }],
      created_at: u.created_at,
      updated_at: u.created_at,
    };
  }

  private session(u: MockUser) {
    const now = Math.floor(Date.now() / 1000);
    const access_token = [
      b64url({ alg: "HS256", typ: "JWT" }),
      b64url({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: randomUUID() }),
      "mock-signature",
    ].join(".");
    const refresh_token = randomUUID();
    this.refreshTokens.set(refresh_token, u.id);
    return { access_token, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token, user: this.publicUser(u) };
  }

  userFromRequest(req: Request): MockUser | undefined {
    const auth = req.headers()["authorization"] || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    try {
      const { sub } = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      return this.users.find((u) => u.id === sub);
    } catch {
      return undefined;
    }
  }

  // ── Event Radar RPCs ───────────────────────────────────────────────────────
  tokenFor(email: string): string | undefined {
    const u = this.users.find((x) => x.email === email);
    return [...this.tokens].reverse().find((t) => t.user_id === u?.id && t.expires_at > Date.now())?.token;
  }

  private profileOf(userId: string, showProfile: boolean) {
    const p = this.table("profiles").find((r) => r.id === userId) || {};
    return showProfile
      ? { name: p.name || "NetworQ attendee", title: p.role ?? null, company: p.company ?? null, avatar: null }
      : { name: (p.name || "Attendee").split(" ")[0], title: p.role ?? null, company: null, avatar: null };
  }

  private eventJson(e: RadarEventRow, uid: string) {
    return { id: e.id, name: e.name, venue: e.venue, starts_at: e.starts_at, ends_at: null, join_code: e.join_code, source: e.source, external_id: e.external_id, is_owner: e.created_by === uid };
  }

  private member(eventId: string, uid: string) {
    const a = this.attendees.find((x) => x.event_id === eventId && x.user_id === uid);
    if (!a) throw new RpcError("not_a_member");
    return a;
  }

  private join(eventId: string, uid: string) {
    const a = this.attendees.find((x) => x.event_id === eventId && x.user_id === uid);
    if (a) a.last_seen_at = Date.now();
    else this.attendees.push({ event_id: eventId, user_id: uid, last_seen_at: Date.now(), radar_on: true, visible: true, show_distance: true, show_profile: true });
  }

  private rpc(fn: string, a: any, uid: string): unknown {
    switch (fn) {
      case "update_notification_prefs": {
        const prof = this.table("profiles").find((r) => r.id === uid)!;
        const cur = prof.notification_prefs || { login_alerts: true, reminder_emails: true, product_updates: false, connection_emails: true };
        prof.notification_prefs = {
          login_alerts: a.p_prefs?.login_alerts ?? cur.login_alerts,
          reminder_emails: a.p_prefs?.reminder_emails ?? cur.reminder_emails,
          product_updates: a.p_prefs?.product_updates ?? cur.product_updates,
          connection_emails: a.p_prefs?.connection_emails ?? cur.connection_emails ?? true,
        };
        return prof.notification_prefs;
      }
      case "nearby_status": {
        const e = this.events.find((ev) => ev.external_id === "networq:nearby");
        const m = e && this.attendees.find((x) => x.event_id === e.id && x.user_id === uid);
        return m ? { ...this.eventJson(e!, uid), settings: { radar_on: m.radar_on, visible: m.visible, show_distance: m.show_distance, show_profile: m.show_profile } } : null;
      }
      case "join_nearby": {
        let e = this.events.find((ev) => ev.external_id === "networq:nearby");
        if (!e) {
          e = { id: randomUUID(), external_id: "networq:nearby", name: "Nearby", venue: null, starts_at: null, join_code: null, source: "nearby" as any, created_by: null as any };
          this.events.push(e);
        }
        this.join(e.id, uid);
        const m = this.member(e.id, uid);
        Object.assign(m, { radar_on: true, visible: !!a.p_discoverable });
        if (!m.visible) this.tokens = this.tokens.filter((t) => !(t.event_id === e!.id && t.user_id === uid));
        return { ...this.eventJson(e, uid), settings: { radar_on: m.radar_on, visible: m.visible, show_distance: m.show_distance, show_profile: m.show_profile } };
      }
      case "leave_nearby": {
        const e = this.events.find((ev) => ev.external_id === "networq:nearby");
        if (e) return this.rpc("leave_event", { p_event_id: e.id }, uid);
        return null;
      }
      case "my_events":
        return this.attendees
          .filter((x) => x.user_id === uid && this.events.find((ev) => ev.id === x.event_id)?.external_id !== "networq:nearby")
          .map((x) => {
            const e = this.events.find((ev) => ev.id === x.event_id)!;
            return { ...this.eventJson(e, uid), attendee_count: this.attendees.filter((y) => y.event_id === e.id).length, settings: { radar_on: x.radar_on, visible: x.visible, show_distance: x.show_distance, show_profile: x.show_profile } };
          });
      case "create_event": {
        const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        const code = "NQ-" + Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
        const e: RadarEventRow = { id: randomUUID(), external_id: null, name: a.p_name, venue: a.p_venue, starts_at: a.p_starts_at, join_code: code, source: "user", created_by: uid };
        this.events.push(e);
        this.join(e.id, uid);
        return this.eventJson(e, uid);
      }
      case "join_event_by_code": {
        const e = this.events.find((ev) => ev.join_code === String(a.p_code).trim().toUpperCase());
        if (!e) return { error: "invalid_code" };
        this.join(e.id, uid);
        return this.eventJson(e, uid);
      }
      case "join_listed_event": {
        let e = this.events.find((ev) => ev.external_id === a.p_external_id);
        if (!e) {
          e = { id: randomUUID(), external_id: a.p_external_id, name: a.p_name, venue: a.p_venue, starts_at: a.p_starts_at, join_code: null, source: "listed", created_by: uid };
          this.events.push(e);
        }
        this.join(e.id, uid);
        return this.eventJson(e, uid);
      }
      case "leave_event":
        this.attendees = this.attendees.filter((x) => !(x.event_id === a.p_event_id && x.user_id === uid));
        this.tokens = this.tokens.filter((t) => !(t.event_id === a.p_event_id && t.user_id === uid));
        return null;
      case "update_radar_settings": {
        const m = this.member(a.p_event_id, uid);
        Object.assign(m, { radar_on: a.p_radar_on, visible: a.p_visible, show_distance: a.p_show_distance, show_profile: a.p_show_profile });
        if (!(m.radar_on && m.visible)) this.tokens = this.tokens.filter((t) => !(t.event_id === a.p_event_id && t.user_id === uid));
        return { radar_on: m.radar_on, visible: m.visible, show_distance: m.show_distance, show_profile: m.show_profile };
      }
      case "issue_radar_token": {
        const m = this.member(a.p_event_id, uid);
        m.last_seen_at = Date.now();
        if (!m.radar_on) throw new RpcError("radar_off");
        const expires = Date.now() + 15 * 60_000;
        if (!m.visible) return { token: null, expires_at: new Date(expires).toISOString() };
        const token = randomUUID().replace(/-/g, "").slice(0, 16);
        this.tokens.push({ token, user_id: uid, event_id: a.p_event_id, expires_at: expires });
        return { token, expires_at: new Date(expires).toISOString() };
      }
      case "resolve_radar_tokens": {
        const me = this.member(a.p_event_id, uid);
        if (!me.radar_on) throw new RpcError("radar_off");
        const wanted: string[] = a.p_tokens || [];
        if (wanted.length > 64) throw new RpcError("too_many_tokens");
        const people = this.tokens
          .filter((t) => t.event_id === a.p_event_id && wanted.includes(t.token) && t.expires_at > Date.now() && t.user_id !== uid && !this.isBlocked(uid, t.user_id))
          .flatMap((t) => {
            const att = this.attendees.find((x) => x.event_id === t.event_id && x.user_id === t.user_id);
            if (!att || !att.radar_on || !att.visible) return [];
            return [{ ...this.profileOf(t.user_id, att.show_profile), token: t.token, user_id: t.user_id, show_distance: att.show_distance, expires_at: new Date(t.expires_at).toISOString() }];
          });
        return me.visible ? { people, hidden_count: 0 } : { people: [], hidden_count: people.length };
      }
      case "list_event_attendees": {
        const me = this.member(a.p_event_id, uid);
        me.last_seen_at = Date.now();
        if (this.events.find((ev) => ev.id === a.p_event_id)?.external_id === "networq:nearby") return { people: [], hidden_count: 0 };
        const people = this.attendees
          .filter((x) => x.event_id === a.p_event_id && x.user_id !== uid && x.radar_on && x.visible && Date.now() - x.last_seen_at < 15 * 60_000)
          .map((x) => ({ ...this.profileOf(x.user_id, x.show_profile), user_id: x.user_id, show_distance: false }));
        return me.radar_on && me.visible ? { people, hidden_count: 0 } : { people: [], hidden_count: people.length };
      }
      case "send_connection_request": {
        this.member(a.p_event_id, uid);
        if (a.p_to_user === uid) throw new RpcError("cannot_connect_to_self");
        this.member(a.p_event_id, a.p_to_user);
        let r = this.requests.find((x) => x.event_id === a.p_event_id && x.from_user === uid && x.to_user === a.p_to_user);
        if (this.isBlocked(uid, a.p_to_user)) throw new RpcError("unavailable");
        if (!r || r.status === "cancelled") {
          if (r) r.status = "pending";
          else {
            r = { id: randomUUID(), event_id: a.p_event_id, from_user: uid, to_user: a.p_to_user, status: "pending", created_at: new Date().toISOString() };
            this.requests.push(r);
          }
          const from = this.table("profiles").find((x) => x.id === uid);
          this.notify(a.p_to_user, "connection_request", `${from?.name || "Someone"} wants to connect`, "Accept to swap contact details.", { request_id: r.id, from_user: uid, event_id: a.p_event_id, screen: "radar" });
        }
        return r;
      }
      case "my_connection_requests":
        this.member(a.p_event_id, uid);
        return {
          incoming: this.requests
            .filter((r) => r.event_id === a.p_event_id && r.to_user === uid && r.status === "pending")
            .map((r) => ({ ...this.profileOf(r.from_user, true), id: r.id, from_user: r.from_user, created_at: r.created_at })),
          outgoing: this.requests.filter((r) => r.event_id === a.p_event_id && r.from_user === uid).map((r) => ({ id: r.id, to_user: r.to_user, status: r.status })),
        };
      case "respond_connection_request": {
        const r = this.requests.find((x) => x.id === a.p_request_id && x.to_user === uid);
        if (!r) throw new RpcError("request_not_found");
        if (r.status !== "pending") return r;
        r.status = a.p_accept ? "accepted" : "declined";
        const me = this.table("profiles").find((x) => x.id === uid);
        this.notify(r.from_user, a.p_accept ? "connection_accepted" : "connection_declined", a.p_accept ? `${me?.name} accepted your request` : "Connection request not accepted", a.p_accept ? "You're connected." : "", { request_id: r.id, from_user: uid, screen: a.p_accept ? "contacts" : "radar" });
        if (a.p_accept) {
          const eventName = this.events.find((e) => e.id === r.event_id)?.name;
          for (const [owner, person] of [[r.from_user, r.to_user], [r.to_user, r.from_user]]) {
            const p = this.table("profiles").find((x) => x.id === person) || {};
            const u = this.users.find((x) => x.id === person);
            this.table("contacts").push({ id: randomUUID(), user_id: owner, name: p.name, title: p.role, company: p.company, email: u?.email, event: eventName, reference: "NetworQ Radar", tags: ["radar"], added_at: new Date().toISOString() });
          }
        }
        return r;
      }
      case "cancel_connection_request": {
        const r = this.requests.find((x) => x.id === a.p_request_id && x.from_user === uid && x.status === "pending");
        if (!r) throw new RpcError("request_not_found");
        r.status = "cancelled";
        this.tables["notifications"] = this.table("notifications").filter((n) => n.data?.request_id !== r.id);
        return r;
      }
      case "block_user":
        if (!this.blocks.some((x) => x.blocker === uid && x.blocked === a.p_user)) this.blocks.push({ blocker: uid, blocked: a.p_user });
        this.requests.filter((r) => r.status === "pending" && ((r.from_user === uid && r.to_user === a.p_user) || (r.from_user === a.p_user && r.to_user === uid))).forEach((r) => (r.status = "cancelled"));
        return null;
      case "unblock_user":
        this.blocks = this.blocks.filter((x) => !(x.blocker === uid && x.blocked === a.p_user));
        return null;
      case "my_blocked_users":
        return this.blocks.filter((x) => x.blocker === uid).map((x) => ({ user_id: x.blocked, name: this.table("profiles").find((p) => p.id === x.blocked)?.name, blocked_at: new Date().toISOString() }));
      case "mark_notifications_read": {
        let n = 0;
        for (const row of this.table("notifications")) if (row.user_id === uid && !row.read_at && (!a.p_ids || a.p_ids.includes(row.id))) { row.read_at = new Date().toISOString(); n++; }
        return n;
      }
      default:
        throw new RpcError(`unknown function ${fn}`);
    }
  }

  private async handleRpc(route: Route) {
    const req = route.request();
    const user = this.userFromRequest(req);
    if (!user) return this.json(route, 401, { code: "PGRST301", message: "JWT required" });
    const fn = new URL(req.url()).pathname.split("/rpc/")[1];
    try {
      const result = this.rpc(fn, JSON.parse(req.postData() || "{}"), user.id);
      return this.json(route, 200, result);
    } catch (err) {
      if (err instanceof RpcError) return this.json(route, 400, { code: "P0001", message: err.message });
      throw err;
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  async attach(context: BrowserContext) {
    // Hermetic: anything that isn't the local app server or Supabase is aborted
    await context.route("**/*", (route) => {
      const { hostname } = new URL(route.request().url());
      if (hostname === "localhost" || hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await context.route(/\/auth\/v1\//, (route) => this.handleAuth(route));
    await context.route(/\/rest\/v1\//, (route) => this.handleRest(route));
    await context.route(/\/storage\/v1\/object\//, (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return this.json(route, 200, {});
      if (!this.userFromRequest(req)) return this.json(route, 403, { message: "Unauthorized" });
      const key = new URL(req.url()).pathname.replace(/^.*\/object\//, "");
      this.uploads.push(key);
      return this.json(route, 200, { Key: key, Id: randomUUID() });
    });
  }

  private json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
    return route.fulfill({
      status,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", ...headers },
      body: body === undefined ? "" : JSON.stringify(body),
    });
  }

  private async handleAuth(route: Route) {
    const req = route.request();
    if (req.method() === "OPTIONS") return this.json(route, 200, {});
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/auth\/v1/, "");
    const body = req.postData() ? JSON.parse(req.postData() as string) : {};

    if (path === "/signup" && req.method() === "POST") {
      if (this.users.some((u) => u.email === body.email)) {
        return this.json(route, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
      }
      if (!body.password || body.password.length < 6) {
        return this.json(route, 422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters." });
      }
      const u = this.addUser(body.email, body.password, { confirmed: this.autoConfirm, metadata: body.data || {} });
      return this.json(route, 200, this.autoConfirm ? this.session(u) : this.publicUser(u));
    }

    if (path === "/token" && req.method() === "POST") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const u = this.users.find((x) => x.email === body.email);
        if (!u || u.password !== body.password) {
          return this.json(route, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        }
        if (!u.confirmed) return this.json(route, 400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" });
        return this.json(route, 200, this.session(u));
      }
      if (grant === "refresh_token") {
        const id = this.refreshTokens.get(body.refresh_token);
        const u = this.users.find((x) => x.id === id);
        if (!u) return this.json(route, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
        return this.json(route, 200, this.session(u));
      }
    }

    if (path === "/user") {
      const u = this.userFromRequest(req);
      if (!u) return this.json(route, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      if (req.method() === "PUT") {
        if (body.password) u.password = body.password;
        if (body.email) (u as any).pendingEmail = body.email;
        if (body.data) Object.assign(u.user_metadata, body.data);
      }
      return this.json(route, 200, this.publicUser(u));
    }

    if (path === "/logout") {
      if (url.searchParams.get("scope") === "global") this.sessionsRevoked++;
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    }
    if (path === "/recover") return this.json(route, 200, {});
    return this.json(route, 200, {});
  }

  private async handleRest(route: Route) {
    const req = route.request();
    if (req.method() === "OPTIONS") return this.json(route, 200, {});
    const url = new URL(req.url());
    if (url.pathname.includes("/rest/v1/rpc/")) return this.handleRpc(route);
    const table = url.pathname.replace(/^.*\/rest\/v1\//, "").split("/")[0];
    const user = this.userFromRequest(req);
    if (!user) return this.json(route, 401, { code: "PGRST301", message: "JWT required" });

    const method = req.method();
    if (this.failNext && (!this.failNext.method || this.failNext.method === method) && (!this.failNext.table || this.failNext.table === table)) {
      this.failNext = null;
      return this.json(route, 500, { code: "XX000", message: "Simulated database failure" });
    }

    const ownerCol = OWNER_COLUMN[table] || "user_id";
    const headers = req.headers();
    const wantsObject = (headers["accept"] || "").includes("vnd.pgrst.object+json");
    const prefer = headers["prefer"] || "";
    const returnRows = prefer.includes("return=representation");

    // RLS: callers only ever see their own rows
    const SHARED_READ = ["public_events"];
    const visible = () => (SHARED_READ.includes(table) ? this.table(table) : this.table(table).filter((r) => r[ownerCol] === user.id));
    const matches = (row: Row) => {
      for (const [key, raw] of url.searchParams) {
        if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
        const [op, ...rest] = raw.split(".");
        const val = rest.join(".");
        if (op === "eq" && String(row[key]) !== val) return false;
        if (op === "neq" && String(row[key]) === val) return false;
        if (op === "is" && val === "null" && row[key] != null) return false;
        if (op === "gte" && !(String(row[key]) >= val)) return false;
        if (op === "lte" && !(String(row[key]) <= val)) return false;
      }
      return true;
    };
    const respond = (rows: Row[], status = 200) => {
      if (wantsObject) {
        if (rows.length !== 1) {
          return this.json(route, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows` });
        }
        return this.json(route, status, rows[0]);
      }
      return this.json(route, status, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    };

    if (method === "GET" || method === "HEAD") {
      let rows = visible().filter(matches);
      const order = url.searchParams.get("order");
      if (order) {
        const [col, dir] = order.split(".");
        rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1));
      }
      const limit = url.searchParams.get("limit");
      if (limit) rows = rows.slice(0, Number(limit));
      return respond(rows);
    }

    if (method === "POST") {
      const payload = JSON.parse(req.postData() || "[]");
      const items: Row[] = Array.isArray(payload) ? payload : [payload];
      if (items.some((r) => r[ownerCol] !== user.id)) {
        return this.json(route, 403, { code: "42501", message: `new row violates row-level security policy for table "${table}"` });
      }
      const upsert = prefer.includes("resolution=merge-duplicates");
      const now = new Date().toISOString();
      const written = items.map((item) => {
        const key = item.id ?? null;
        const existing = upsert && key ? this.table(table).find((r) => r.id === key) : undefined;
        if (existing) return Object.assign(existing, item);
        const row = { id: randomUUID(), created_at: now, added_at: now, ...item };
        this.table(table).push(row);
        return row;
      });
      return returnRows ? respond(written, 201) : route.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" } });
    }

    if (method === "PATCH") {
      const patch = JSON.parse(req.postData() || "{}");
      const rows = visible().filter(matches);
      rows.forEach((r) => Object.assign(r, patch));
      return returnRows ? respond(rows) : route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    }

    if (method === "DELETE") {
      const rows = visible().filter(matches);
      this.tables[table] = this.table(table).filter((r) => !rows.includes(r));
      return returnRows ? respond(rows) : route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    }

    return this.json(route, 405, { message: "Method not allowed" });
  }
}
