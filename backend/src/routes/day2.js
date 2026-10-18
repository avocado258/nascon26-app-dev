// Phase II audit + public API routes.
const express = require('express');
const keys = require('../streaming/keys');
const costream = require('../costream/engine');
const guest = require('../guest/engine');
const moderation = require('../moderation/engine');
const chat = require('../realtime/chat');
const hub = require('../realtime/hub');
const qr = require('../qr/engine');
const dlq = require('../notify/dlq');
const registry = require('../state/registry');
const auth = require('../auth/jwt');
const athletes = require('../social/athletes');
const { guardWrite } = require('../auth/guest');
const { ApiError, sendError } = require('../utils/errors');

const wrap = (fn) => async (req, res) => {
  try {
    const { status, body } = await fn(req);
    res.status(status).json(body);
  } catch (err) {
    sendError(res, err);
  }
};

// ---- /audit/v1 ----
const audit = express.Router();
audit.post('/stream/key', wrap((req) => keys.handle(req.body || {})));
audit.post('/costream/session', wrap((req) => costream.start(req.body || {})));
audit.post('/guest/cart-merge', wrap((req) => guest.merge(req.body || {})));
audit.post('/moderation/test', wrap((req) => ({ status: 200, body: moderation.runProbe(req.body || {}) })));
// Day 1 checkout is out of Day 2 scope; the guest write guard is enforced (D2 5.7).
audit.post('/checkout', guardWrite, wrap(() => {
  throw new ApiError(501, 'NOT_IMPLEMENTED', 'Checkout is not available in this build', {});
}));
audit.get('/inventory/:variant_id', wrap((req) => {
  const v = registry.state.variants.get(req.params.variant_id);
  if (!v) throw new ApiError(404, 'VARIANT_NOT_FOUND', `Variant ${req.params.variant_id} not found`, { variant_id: req.params.variant_id });
  return { status: 200, body: { variant_id: v.variant_id, stock: v.stock, reserved: v.reserved } };
}));
audit.delete('/privacy/user/:user_id', wrap((req) => {
  const userId = req.params.user_id;
  const user = registry.state.users.get(userId);
  if (!user) throw new ApiError(404, 'PLAYER_NOT_FOUND', `User ${userId} not found`, { user_id: userId });
  if (user.email) registry.state.usersByEmail.delete(user.email);
  Object.assign(user, { email: null, name: null, anonymized: true, tokens_revoked_at: Date.now() });
  const player = registry.state.players.get(userId);
  if (player) player.name = `anonymized-${userId.length}`;
  for (const t of registry.state.guestTokens.values()) {
    if (t.merged_user_id === userId) Object.assign(t, { merged_user_id: null, anonymized: true, revoked: true });
  }
  return { status: 200, body: { user_id: userId, status: 'anonymized', pii_retained: false, tokens_wiped: true } };
}));

// ---- /api/v1 (mobile + Guest Web Player) ----
const api = express.Router();
api.get('/ping', (req, res) => res.status(200).json({ pong: true }));
api.post('/auth/login', wrap((req) => ({ status: 200, body: auth.login(req.body?.email, req.body?.password) })));
api.post('/guest/token', wrap(() => ({ status: 201, body: guest.issueToken() })));
api.get('/guest/cart', wrap((req) => ({ status: 200, body: guest.stagedCart(String(req.query.guest_token || '')) })));
api.post('/guest/cart', wrap((req) => ({ status: 200, body: guest.stageItem(req.body?.guest_token, req.body?.variant_id, req.body?.quantity ?? 1) })));
api.get('/matches/:id/score', wrap((req) => {
  const p = hub.scorePayload(req.params.id);
  if (!p) throw new ApiError(404, 'MATCH_NOT_FOUND', `Match ${req.params.id} not found`, { match_id: req.params.id });
  return { status: 200, body: p };
}));
api.get('/matches/:id/stream', hub.sse('match'));
api.get('/chat/:id/stream', hub.sse('chat'));
api.get('/chat/:id/messages', wrap((req) => ({ status: 200, body: { chat_room_id: req.params.id, messages: chat.history(req.params.id) } })));
api.get('/products/pinned', wrap(() => {
  const v = registry.state.variants.get('var-jersey-001-L');
  const p = registry.state.products.get('prod-jersey-001');
  return { status: 200, body: { product_id: p.product_id, name: p.name, variant_id: v.variant_id, size: v.size, price_minor: v.price_minor, currency: v.currency, stock: v.stock } };
}));
api.get('/players/:id', wrap((req) => ({ status: 200, body: athletes.profile(req.params.id) })));
// Following an athlete is a protected write: guests get 403 GUEST_WRITE_FORBIDDEN (D2 FR-4.3).
api.post('/athletes/:id/follow', guardWrite, auth.requireMember, wrap((req) => ({ status: 200, body: athletes.setFollow(req.params.id, req.user.user_id, true) })));
api.delete('/athletes/:id/follow', guardWrite, auth.requireMember, wrap((req) => ({ status: 200, body: athletes.setFollow(req.params.id, req.user.user_id, false) })));
api.get('/clubs/:id', wrap((req) => {
  const c = registry.state.clubs.get(req.params.id);
  if (!c) throw new ApiError(404, 'NOT_FOUND', `Club ${req.params.id} not found`, { club_id: req.params.id });
  const roster = [...registry.state.players.values()].filter((p) => p.club_id === c.club_id).map((p) => ({ player_id: p.player_id, name: p.name }));
  return { status: 200, body: { club_id: c.club_id, name: c.name, tenant_id: c.tenant_id, roster } };
}));
api.get('/cart', auth.requireMember, wrap((req) => ({ status: 200, body: guest.activeCart(req.user.user_id) })));

// Live chat: guests are refused (403) before auth; members are moderated, sequenced and broadcast.
const senderWindow = new Map(); // sender -> timestamps (ms) in the last 2 s
api.post('/chat', guardWrite, auth.requireMember, wrap((req) => {
  const body = req.body || {};
  if (typeof body.chat_room_id !== 'string' || !body.chat_room_id || typeof body.text !== 'string' || !body.text) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'chat_room_id and text are required', { fields: ['chat_room_id', 'text'].filter((f) => !body[f]) });
  }
  const sender = req.user.user_id;
  const now = Date.now();
  const recent = (senderWindow.get(sender) || []).filter((t) => now - t < 2000);
  recent.push(now);
  senderWindow.set(sender, recent);
  if (recent.length > 3) throw new ApiError(429, 'RATE_LIMITED', 'More than 3 messages in 2 seconds', { reason: 'rate_limit_exceeded', sender });
  const r = moderation.moderate({ text: body.text });
  if (r.action === 'drop') throw new ApiError(409, 'MESSAGE_BLOCKED', 'Message blocked by flood filter', { reason: r.reason, sender });
  const entry = chat.publish(body.chat_room_id, { message_id: body.message_id || `msg-${now}`, sender, text: r.text, flagged: r.action === 'flag', reason: r.reason });
  return { status: 201, body: entry };
}));

// ---- /metrics (Prometheus text exposition 0.0.4) ----
let lastBytes = null;
async function mediaStats() {
  const apiBase = process.env.MEDIAMTX_API;
  if (!apiBase) return { streams: keys.activeCount(), kbps: 0 };
  try {
    const r = await fetch(`${apiBase}/v3/paths/list`, { signal: AbortSignal.timeout(800) });
    const { items = [] } = await r.json();
    const ready = items.filter((p) => p.ready);
    const bytes = ready.reduce((s, p) => s + (p.bytesReceived || 0), 0);
    const now = Date.now();
    let kbps = 0;
    if (lastBytes && now > lastBytes.at && bytes >= lastBytes.bytes) kbps = ((bytes - lastBytes.bytes) * 8) / 1000 / ((now - lastBytes.at) / 1000);
    lastBytes = { bytes, at: now };
    return { streams: ready.length, kbps };
  } catch {
    return { streams: 0, kbps: 0 };
  }
}

async function metrics(req, res) {
  const m = await mediaStats();
  const lines = [
    ['nascon_active_ws_connections', 'gauge', 'Open realtime connections (WebSocket + SSE).', hub.stats.ws + hub.stats.sse],
    ['nascon_active_streams_total', 'gauge', 'Live streams currently publishing to the media server.', m.streams],
    ['nascon_stream_bitrate_kbps', 'gauge', 'Aggregate ingest bitrate across live streams in kbps.', Number(m.kbps.toFixed(3))],
    ['nascon_dlq_depth', 'gauge', 'Notifications currently in the dead-letter queue.', dlq.depth()],
    ['nascon_qr_scans_total', 'counter', 'Dynamic QR scans resolved since the last reset.', qr.counters.scansTotal],
  ].map(([name, type, help, value]) => `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}`).join('\n');
  // Raw writeHead so Express does not append "; charset=utf-8" to the exact content type (D2 5.9).
  const body = Buffer.from(`${lines}\n`, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4', 'Content-Length': body.length });
  res.end(body);
}

module.exports = { audit, api, metrics };
