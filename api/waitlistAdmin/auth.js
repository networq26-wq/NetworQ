// Admin sign-in.
//   • the owner is WAITLIST_ADMIN_USER (default "admin") + WAITLIST_ADMIN_PASSWORD (Render settings);
//     no password set → the whole admin panel is off
//   • the owner can add more admins (scrypt-hashed passwords in admin_users) and disable them
//   • session cookie = base64url(username).expiry.HMAC, keyed by a server secret and the admin's
//     current password, so changing a password (or disabling an admin) signs that admin out
const crypto = require("crypto");

const COOKIE = "nq_wl_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function owner() {
  const password = process.env.WAITLIST_ADMIN_PASSWORD;
  return password ? { username: (process.env.WAITLIST_ADMIN_USER || "admin").toLowerCase(), password } : null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}
function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const got = crypto.scryptSync(String(password), Buffer.from(salt, "base64url"), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hash, "base64url");
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}

function passwordProblem(pw) {
  if (String(pw).length < 10) return "Use at least 10 characters.";
  if (String(pw).length > 200) return "That password is too long.";
  return "";
}

const secret = () => `${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}|${process.env.WAITLIST_ADMIN_PASSWORD || ""}`;
function mac(username, exp, material) {
  return crypto.createHmac("sha256", sha(`nq-admin|${secret()}|${username}|${material}`)).update(`${username}.${exp}`).digest("base64url");
}

function sessionValue(admin, exp = Date.now() + SESSION_MS) {
  return `${Buffer.from(admin.username).toString("base64url")}.${exp}.${mac(admin.username, exp, admin.material)}`;
}

function readCookie(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || "");
  return m ? m[1] : "";
}

function cookieFlags(req) {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  return `Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}
const setSession = (req, res, admin) => res.setHeader("Set-Cookie", `${COOKIE}=${sessionValue(admin)}; Max-Age=${SESSION_MS / 1000}; ${cookieFlags(req)}`);
const clearSession = (req, res) => res.setHeader("Set-Cookie", `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);

// → { username, isOwner, id?, material } or null
async function adminFor(username, store) {
  const o = owner();
  if (!o) return null;
  if (username === o.username) return { username, isOwner: true, material: o.password };
  if (!USERNAME_RE.test(username)) return null;
  const a = await store.findAdmin(username).catch(() => null);
  if (!a || a.disabled_at) return null;
  return { username, isOwner: false, id: a.id, material: a.password_hash, hash: a.password_hash };
}

async function currentAdmin(req, store) {
  const o = owner();
  if (!o) return null;
  // Basic auth (scripts / spreadsheets): ID:password
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization || "");
  if (basic) {
    const d = Buffer.from(basic[1], "base64").toString("utf8");
    const i = d.indexOf(":");
    if (i > 0) return login(d.slice(0, i), d.slice(i + 1), store);
  }
  const [u64, exp, sig] = readCookie(req).split(".");
  if (!u64 || !exp || !sig || !(Number(exp) > Date.now())) return null;
  let username = "";
  try {
    username = Buffer.from(u64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const admin = await adminFor(username, store);
  return admin && safeEqual(sig, mac(username, exp, admin.material)) ? admin : null;
}

// Checks ID + password → admin or null (constant-ish time for the owner path)
async function login(id, password, store) {
  const o = owner();
  if (!o) return null;
  const username = String(id || "").trim().toLowerCase();
  const isOwnerId = safeEqual(username, o.username);
  const ownerPass = safeEqual(String(password || ""), o.password);
  if (isOwnerId) return ownerPass ? { username: o.username, isOwner: true, material: o.password } : null;
  const admin = await adminFor(username, store);
  if (!admin || !verifyPassword(password, admin.hash)) return null;
  return admin;
}

module.exports = { COOKIE, SESSION_MS, USERNAME_RE, owner, hashPassword, verifyPassword, passwordProblem, currentAdmin, login, setSession, clearSession, sessionValue };
