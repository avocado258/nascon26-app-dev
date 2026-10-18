// Creator stream-key lifecycle (D2 5.4) and the MediaMTX publish/read authorisation hook.
const crypto = require('crypto');
const { registerReset } = require('../seed');
const registry = require('../state/registry');
const { ApiError } = require('../utils/errors');
const { signDay2 } = require('../utils/sign');

const ACTIONS = ['generate', 'rotate', 'revoke'];
const current = new Map(); // player_id -> stream_key (latest, active or revoked)
const keys = new Map();    // stream_key -> { stream_key, player_id, label, status }
registerReset(() => { current.clear(); keys.clear(); });

const mediaApi = () => process.env.MEDIAMTX_API;

function validate(body) {
  const fields = [];
  if (!ACTIONS.includes(body.action)) fields.push('action');
  if (typeof body.player_id !== 'string' || !body.player_id) fields.push('player_id');
  if (body.label !== undefined && !(typeof body.label === 'string' && body.label.length >= 1 && body.label.length <= 64)) fields.push('label');
  if (body.stream_key_override !== undefined && !(typeof body.stream_key_override === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(body.stream_key_override))) {
    fields.push('stream_key_override');
  }
  if (fields.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid stream key request', { fields });
}

function view(rec, action) {
  const active = rec.status === 'active';
  const k = rec.stream_key;
  return {
    player_id: rec.player_id,
    label: rec.label,
    stream_key: k,
    status: rec.status,
    ingest_endpoints: active ? { rtmp: `rtmp://localhost:1935/live/${k}`, webrtc: `http://localhost:8889/live/${k}/whip` } : null,
    playback_url: active ? `http://localhost:8888/live/${k}/index.m3u8` : null,
    signature: signDay2(k, { action, player_id: rec.player_id, status: rec.status, stream_key: k }),
  };
}

function revokeKey(streamKey) {
  const rec = keys.get(streamKey);
  if (rec && rec.status === 'active') {
    rec.status = 'revoked';
    kickIngest(streamKey);
  }
}

function handle(body) {
  validate(body);
  const { action, player_id: playerId } = body;
  if (!registry.state.players.has(playerId)) throw new ApiError(404, 'PLAYER_NOT_FOUND', `Player ${playerId} not found`, { player_id: playerId });

  if (action === 'revoke') {
    const key = current.get(playerId);
    if (!key) throw new ApiError(404, 'STREAM_NOT_FOUND', `Player ${playerId} has no stream key`, { player_id: playerId });
    revokeKey(key);
    return { status: 200, body: view(keys.get(key), action) };
  }

  const prior = current.get(playerId);
  if (prior) revokeKey(prior);
  const streamKey = body.stream_key_override ?? `sk_live_${crypto.randomBytes(8).toString('hex')}`;
  const rec = { stream_key: streamKey, player_id: playerId, label: body.label ?? 'default', status: 'active' };
  keys.set(streamKey, rec);
  current.set(playerId, streamKey);
  return { status: action === 'generate' ? 201 : 200, body: view(rec, action) };
}

// MediaMTX authHTTPAddress: any non-2xx refuses the publish/read.
function authorizeMedia({ action, path }) {
  const m = /^live\/([^/]+)$/.exec(path || '');
  if (!m || !['publish', 'read', 'playback'].includes(action)) return { status: 200, body: { ok: true } };
  const rec = keys.get(m[1]);
  if (!rec) return { status: 404, body: { error: { code: 'STREAM_NOT_FOUND', message: 'Unknown stream key', details: { stream_key: m[1] } } } };
  if (rec.status !== 'active') return { status: 409, body: { error: { code: 'KEY_REVOKED', message: 'Stream key has been revoked', details: { stream_key: m[1] } } } };
  return { status: 200, body: { ok: true } };
}

// Severs live ingest/playback sessions on a revoked key via the MediaMTX control API (target < 2 s).
async function kickIngest(streamKey) {
  const api = mediaApi();
  if (!api) return;
  const path = `live/${streamKey}`;
  const kinds = ['rtmpconns', 'webrtcsessions', 'rtspsessions', 'srtconns'];
  await Promise.all(kinds.map(async (kind) => {
    try {
      const r = await fetch(`${api}/v3/${kind}/list`, { signal: AbortSignal.timeout(1000) });
      if (!r.ok) return;
      const { items = [] } = await r.json();
      await Promise.all(items.filter((i) => i.path === path).map((i) => fetch(`${api}/v3/${kind}/kick/${i.id}`, { method: 'POST', signal: AbortSignal.timeout(1000) })));
    } catch { /* media server unavailable: nothing to sever */ }
  }));
}

const activeCount = () => [...keys.values()].filter((k) => k.status === 'active').length;

module.exports = { handle, authorizeMedia, activeCount };
