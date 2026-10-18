// /api/v1/* rate limit (D1 5.13, D2 App. B): 100 requests per rolling 10 s per client IP → 429 RATE_LIMITED + Retry-After.
// /audit/v1/* and /health are never mounted behind this limiter.
const { registerReset } = require('../seed');
const { errorBody } = require('../utils/errors');

const LIMIT = 100;
const WINDOW_MS = 10_000;
const hits = new Map(); // ip -> ascending timestamps (ms) inside the window
registerReset(() => hits.clear());

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    const retryAfter = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json(errorBody('RATE_LIMITED', 'Too many requests: 100 per 10 seconds', { retry_after_seconds: retryAfter }));
  }
  recent.push(now);
  hits.set(ip, recent);
  next();
}

module.exports = { rateLimit, LIMIT, WINDOW_MS };
