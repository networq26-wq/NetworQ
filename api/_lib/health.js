// In-memory health counters for the admin panel: requests and server errors (5xx) since the
// server last started, the most recent errors, and email-sending failures. Nothing is stored
// on disk, so the numbers reset when Render restarts or redeploys the server.
const startedAt = Date.now();
let requests = 0;
let serverErrors = 0;
const recentErrors = [];
let emailsSent = 0;
let emailFailures = 0;
const recentEmailFailures = [];

const push = (list, item) => {
  list.unshift(item);
  if (list.length > 50) list.pop();
};

function healthMiddleware(req, res, next) {
  res.on("finish", () => {
    requests++;
    if (res.statusCode >= 500) {
      serverErrors++;
      push(recentErrors, { at: Date.now(), method: req.method, path: String(req.originalUrl || req.url || "").split("?")[0].slice(0, 120), status: res.statusCode });
    }
  });
  next();
}

function recordEmail(ok, info = {}) {
  if (ok) emailsSent++;
  else {
    emailFailures++;
    push(recentEmailFailures, { at: Date.now(), subject: String(info.subject || "").slice(0, 80), error: String(info.error || "").slice(0, 160) });
  }
}

function healthSnapshot() {
  return {
    startedAt,
    uptimeMs: Date.now() - startedAt,
    requests,
    serverErrors,
    recentErrors: recentErrors.slice(),
    emailsSent,
    emailFailures,
    recentEmailFailures: recentEmailFailures.slice(),
    memoryMb: Math.round(process.memoryUsage().rss / 1e6),
    node: process.version,
  };
}

module.exports = { healthMiddleware, recordEmail, healthSnapshot };
