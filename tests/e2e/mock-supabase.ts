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

export class MockSupabase {
  users: MockUser[] = [];
  tables: Record<string, Row[]> = {};
  autoConfirm = true;
  failNext: { method?: string; table?: string } | null = null;
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
        if (body.data) Object.assign(u.user_metadata, body.data);
      }
      return this.json(route, 200, this.publicUser(u));
    }

    if (path === "/logout") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    if (path === "/recover") return this.json(route, 200, {});
    return this.json(route, 200, {});
  }

  private async handleRest(route: Route) {
    const req = route.request();
    if (req.method() === "OPTIONS") return this.json(route, 200, {});
    const url = new URL(req.url());
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
    const visible = () => this.table(table).filter((r) => r[ownerCol] === user.id);
    const matches = (row: Row) => {
      for (const [key, raw] of url.searchParams) {
        if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
        const [op, ...rest] = raw.split(".");
        const val = rest.join(".");
        if (op === "eq" && String(row[key]) !== val) return false;
        if (op === "neq" && String(row[key]) === val) return false;
        if (op === "is" && val === "null" && row[key] != null) return false;
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
