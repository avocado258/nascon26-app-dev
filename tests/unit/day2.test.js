// Unit tests for the five Phase II modules (COVERAGE_DAY2.json): streaming, costream, qr, guest, moderation.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DAY2_SALT = 'T01D27ad7ffff12e';
delete process.env.MEDIAMTX_API;

const { seedBaseline } = require('../../backend/src/seed');
const keys = require('../../backend/src/streaming/keys');
const costream = require('../../backend/src/costream/engine');
const qr = require('../../backend/src/qr/engine');
const guest = require('../../backend/src/guest/engine');
const moderation = require('../../backend/src/moderation/engine');
const dlq = require('../../backend/src/notify/dlq');
const engine = require('../../backend/src/scoring/engine');
const registry = require('../../backend/src/state/registry');

const code = (fn) => { try { fn(); return null; } catch (e) { return `${e.status} ${e.code}`; } };
const FOUR = ['player-alpha-1', 'player-alpha-2', 'player-beta-1', 'player-beta-2'];

test.beforeEach(() => seedBaseline());

// ---------------- streaming ----------------
test('stream key: spec vector signature and lifecycle', () => {
  const r = keys.handle({ action: 'rotate', player_id: 'player-alpha-1', stream_key_override: 'sk_live_9f83a1b2c3d4e5f6' });
  assert.equal(r.status, 200);
  assert.equal(r.body.signature, '9bd054eb746844b4701c6f158209c315ef2b16f392efd733bdf0715940610289');
  assert.equal(r.body.label, 'default');
  const g = keys.handle({ action: 'generate', player_id: 'player-alpha-1', label: 'Phone' });
  assert.equal(g.status, 201);
  assert.match(g.body.stream_key, /^sk_live_[a-f0-9]{16}$/);
  assert.equal(keys.authorizeMedia({ action: 'publish', path: 'live/sk_live_9f83a1b2c3d4e5f6' }).body.error.code, 'KEY_REVOKED');
  assert.equal(keys.authorizeMedia({ action: 'publish', path: `live/${g.body.stream_key}` }).status, 200);
  assert.equal(keys.authorizeMedia({ action: 'read', path: 'live/unknown' }).status, 404);
  assert.equal(keys.authorizeMedia({ action: 'read', path: 'matches/match-m1' }).status, 200);
  assert.equal(keys.activeCount(), 1);
  const v = keys.handle({ action: 'revoke', player_id: 'player-alpha-1' });
  assert.deepEqual([v.status, v.body.status, v.body.ingest_endpoints, v.body.playback_url], [200, 'revoked', null, null]);
  assert.equal(keys.activeCount(), 0);
  assert.equal(keys.handle({ action: 'revoke', player_id: 'player-alpha-1' }).body.status, 'revoked');
});

test('stream key: validation and not-found', () => {
  assert.equal(code(() => keys.handle({ action: 'nope', player_id: 'player-alpha-1' })), '400 VALIDATION_ERROR');
  assert.equal(code(() => keys.handle({ action: 'generate', player_id: 'player-alpha-1', label: '' })), '400 VALIDATION_ERROR');
  assert.equal(code(() => keys.handle({ action: 'generate', player_id: 'player-alpha-1', stream_key_override: 'bad key' })), '400 VALIDATION_ERROR');
  assert.equal(code(() => keys.handle({ action: 'generate', player_id: 'ghost' })), '404 PLAYER_NOT_FOUND');
  assert.equal(code(() => keys.handle({ action: 'revoke', player_id: 'player-beta-1' })), '404 STREAM_NOT_FOUND');
});

// ---------------- costream ----------------
test('costream: handoff, replay, termination', () => {
  const body = { session_id: 'cs-session-101', host_player_id: 'player-alpha-1', participants: FOUR, simulate_host_drop: true };
  const r = costream.start(body);
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.active_host, r.body.handoff_occurred, r.body.participant_count, r.body.layout], ['player-alpha-2', true, 3, 'grid_4']);
  assert.equal(costream.start(body).status, 200);
  assert.equal(costream.start({ ...body, simulate_host_drop: false }).status, 200);
  assert.equal(costream.get('cs-session-101').active_host, 'player-alpha-1');
  const t = costream.start({ session_id: 's1', host_player_id: 'player-beta-1', participants: ['player-beta-1'], layout: 'solo', simulate_host_drop: true });
  assert.deepEqual([t.body.status, t.body.active_host, t.body.participant_count], ['terminated', null, 0]);
});

test('costream: error order', () => {
  const base = { session_id: 's', host_player_id: 'player-alpha-1', participants: FOUR };
  assert.equal(code(() => costream.start({ ...base, participants: ['a', 'a'] })), '400 VALIDATION_ERROR');
  assert.equal(code(() => costream.start({ ...base, simulate_host_drop: 'yes' })), '400 VALIDATION_ERROR');
  assert.equal(code(() => costream.start({ ...base, participants: [...FOUR, 'player-x'] })), '409 COSTREAM_SESSION_FULL');
  assert.equal(code(() => costream.start({ ...base, participants: ['player-alpha-1', 'ghost'] })), '404 PLAYER_NOT_FOUND');
  assert.equal(code(() => costream.start({ ...base, host_player_id: 'player-beta-2', participants: ['player-alpha-1'] })), '400 VALIDATION_ERROR');
  assert.equal(code(() => costream.start({ ...base, layout: 'grid_2' })), '400 UNSUPPORTED_LAYOUT');
});

// ---------------- qr ----------------
test('qr: dynamic target routes and scan counting', () => {
  const a = qr.resolve('match-m1', { userAgent: 'Mozilla/5.0 (Linux; Android 13) Mobile' });
  assert.deepEqual([a.target_route, a.scan_count, a.short_url], ['/web/matches/match-m1/live', 1, 'http://localhost:8080/q/m1-live']);
  assert.equal(qr.resolve('match-m1', { inspect: true }).scan_count, 1);
  assert.equal(qr.telemetry[0].device_family, 'mobile');
  assert.equal(Object.keys(qr.telemetry[0]).includes('ip'), false);
  engine.append({ event_id: 'q1', match_id: 'match-m1', type: 'match_status', payload: { status: 'postponed' } });
  const b = qr.resolveShortCode('m1-live', 'desktop');
  assert.equal(b.target_route, '/web/matches/match-m1/notice?state=postponed');
  assert.notEqual(b.signature, a.signature);
  engine.append({ event_id: 'q0', match_id: 'm-up', type: 'match_init', payload: { sport_id: 'football', home_team_id: 'x', away_team_id: 'y' } });
  assert.equal(qr.resolve('m-up').target_route, '/web/matches/m-up/preview');
  engine.append({ event_id: 'q2', match_id: 'm-up', type: 'match_start', payload: {} });
  engine.append({ event_id: 'q3', match_id: 'm-up', type: 'match_end', payload: {} });
  assert.equal(qr.resolve('m-up').target_route, '/web/matches/m-up/vod');
  assert.equal(qr.resolve('club-alpha-1').target_route, '/web/clubs/club-alpha-1');
  assert.equal(qr.resolve('player-beta-2').target_route, '/web/players/player-beta-2');
  costream.start({ session_id: 'cs-session-9', host_player_id: 'player-alpha-1', participants: ['player-alpha-1'] });
  assert.equal(qr.resolve('cs-session-9').entity_type, 'costream');
  assert.equal(code(() => qr.resolve('nothing-here')), '404 QR_NOT_FOUND');
  assert.equal(code(() => qr.resolveShortCode('zzz')), '404 QR_NOT_FOUND');
  assert.equal(qr.counters.scansTotal, 7);
});

test('qr: exports are real SVG/PNG/PDF', async () => {
  const svg = await qr.exportQr('match-m1', 'svg');
  assert.ok(svg.body.startsWith('<svg'));
  const png = await qr.exportQr('club-alpha-1', 'png');
  assert.deepEqual([...png.body.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pdf = await qr.exportQr('player-alpha-1', 'pdf');
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
});

// ---------------- guest ----------------
test('guest: tokens, staging, merge, replay, conflicts', () => {
  const t = guest.issueToken();
  assert.match(t.guest_token, /^guest_anon_tok_[0-9a-f]{16}$/);
  assert.equal(guest.stageItem(t.guest_token, 'var-jersey-001-L', 2).total_items, 2);
  assert.equal(guest.stageItem(t.guest_token, 'var-jersey-001-L', 1).total_items, 3);
  assert.equal(guest.stagedCart(t.guest_token).items.length, 1);
  assert.equal(code(() => guest.stageItem('nope', 'var-jersey-001-L', 1)), '400 VALIDATION_ERROR');
  assert.equal(code(() => guest.stageItem(t.guest_token, 'var-jersey-001-L', 0)), '400 VALIDATION_ERROR');
  assert.equal(code(() => guest.stageItem(t.guest_token, 'var-x', 1)), '404 VARIANT_NOT_FOUND');

  const body = { guest_token: 'guest_anon_tok_7721', registered_user_id: 'player-alpha-1', guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 1 }] };
  const m = guest.merge(body);
  assert.deepEqual([m.status, m.body.write_rejection_code, m.body.active_cart.total_items], [200, 403, 1]);
  assert.deepEqual(guest.merge(body).body, m.body);
  assert.equal(code(() => guest.merge({ ...body, registered_user_id: 'player-alpha-2' })), '409 GUEST_TOKEN_ALREADY_MERGED');
  const noBlock = guest.merge({ ...body, guest_token: 'guest_b', test_write_block: false });
  assert.deepEqual([noBlock.body.write_block_verified, noBlock.body.write_rejection_code, noBlock.body.active_cart.total_items], [false, null, 2]);
  assert.equal(guest.activeCart('player-alpha-1').subtotal_minor, 900000);
  assert.equal(code(() => guest.merge({ ...body, guest_token: 'guest_c', guest_cart: [{ variant_id: 'var-jersey-001-M', quantity: 2 }] })), '409 OUT_OF_STOCK');
  assert.equal(code(() => guest.merge({ ...body, guest_token: 'x' })), '400 VALIDATION_ERROR');
  assert.equal(code(() => guest.merge({ ...body, guest_cart: new Array(11).fill(body.guest_cart[0]) })), '400 VALIDATION_ERROR');
  assert.equal(code(() => guest.merge({ ...body, guest_cart: [null] })), '400 VALIDATION_ERROR');
  assert.equal(code(() => guest.merge({ ...body, test_write_block: 'y' })), '400 VALIDATION_ERROR');
  assert.equal(code(() => guest.merge({ ...body, guest_token: 'guest_d', registered_user_id: 'ghost' })), '404 PLAYER_NOT_FOUND');
  assert.equal(code(() => guest.merge({ ...body, guest_token: 'guest_d', guest_cart: [{ variant_id: 'v', quantity: 1 }] })), '404 VARIANT_NOT_FOUND');
  assert.equal(registry.state.variants.get('var-jersey-001-L').stock, 5);
});

// ---------------- moderation ----------------
test('moderation: spec example, masking, flood, DLQ', () => {
  const r = moderation.runProbe({
    chat_room_id: 'chat-cs-session-101',
    incoming_messages: [
      { message_id: 'msg-1', sender: 'user-guest-1', text: 'Clean sports commentary' },
      { message_id: 'msg-2', sender: 'user-spammer', text: 'Watch this illegal stream b@d_w0rd now!' },
      { message_id: 'msg-3', sender: 'user-flooder', text: 'GOAL! AAAA!!!' },
      { message_id: 'msg-4', sender: 'user-spammer', text: 'sc@m' },
    ],
    check_dlq: true,
    simulate_failed_notifications: 2,
  });
  assert.equal(r.filtered_messages[1].text, 'Watch this illegal stream *** now!');
  assert.deepEqual([r.kicked_users, r.muted_users, r.dlq_status.queue_depth], [['user-spammer'], ['user-flooder'], 2]);
  assert.equal(r.dlq_status.undelivered_events[0].attempts, 3);
  for (const [text, out] of [['p.0.r.n', '***'], ['f*u*c*k!', '***!'], ['sh!t!', '***!'], ['(a$$h0le)', '(***)'], ['b​itch', '***'], ['scampi', 'scampi']]) {
    assert.equal(moderation.mask(text).text, out, text);
  }
  assert.equal(moderation.isFlood('what???'), true);
  assert.equal(moderation.isFlood('Goal! Great!'), false);
  assert.equal(moderation.moderate({ text: 'hello' }).action, 'pass');
  assert.equal(code(() => moderation.runProbe({ chat_room_id: '', incoming_messages: [] })), '400 VALIDATION_ERROR');
  assert.equal(code(() => moderation.runProbe({ chat_room_id: 'r', incoming_messages: [{}], check_dlq: 1, simulate_failed_notifications: -1 })), '400 VALIDATION_ERROR');
});

test('dlq: successful delivery is not dead-lettered; retries are bounded', () => {
  let calls = 0;
  const ok = dlq.dispatch({ type: 'score' }, () => { calls += 1; return calls === 2; });
  assert.deepEqual([ok.delivered, ok.attempts.length, dlq.depth()], [true, 2, 0]);
  const bad = dlq.dispatch({ type: 'invite', target: 'u1' }, () => false);
  assert.deepEqual([bad.delivered, bad.attempts.map((a) => a.backoff_ms), dlq.depth()], [false, [0, 100, 200], 1]);
  assert.equal(dlq.snapshot()[0].last_error, 'delivery_failed');
});
