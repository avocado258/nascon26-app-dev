const test = require('node:test');
const assert = require('node:assert/strict');
const { canonical, hmac, lotsKey } = require('../../backend/src/utils/sign');

// Expected values computed with the spec's Python reference (D1 App. A, D2 App. A).
test('Day 1 vector 1', () => {
  assert.equal(canonical({ team_id: 't1', event_type: 'goal' }), '{"event_type":"goal","team_id":"t1"}');
  assert.equal(hmac('demo-salt', 'evt-1', { team_id: 't1', event_type: 'goal' }),
    '972a8b558690b19121cc5bea84978f85e8eb15a3735018db36616bab1d7ec501');
});

test('Day 2 vector 1: 4-key stream key payload', () => {
  assert.equal(hmac('T01D27ad7ffff12e', 'sk_live_9f83a1b2c3d4e5f6',
    { action: 'rotate', player_id: 'player-alpha-1', status: 'active', stream_key: 'sk_live_9f83a1b2c3d4e5f6' }),
  '9bd054eb746844b4701c6f158209c315ef2b16f392efd733bdf0715940610289');
});

test('Day 2 vector 2: legacy 2-key payload', () => {
  assert.equal(hmac('T01D27ad7ffff12e', 'sk_live_101', { action: 'rotate', player_id: 'player-alpha-1' }),
    '830b24eb2c795c02c54c17516b0e96870f5b65d98d28c2f0a15619ec3e076188');
});

test('nested keys sorted, arrays kept, non-ASCII unescaped, null/bool lowercase', () => {
  const p = { b: [1, { z: 'é', a: null }], a: true };
  assert.equal(canonical(p), '{"a":true,"b":[1,{"a":null,"z":"é"}]}');
  assert.equal(hmac('s', 'id', p), 'b4a3523bb2d3ba15db4c3c2e3f0a108bc285346ffe886076f16c52eb5b31a41f');
});

test('Day 1 vector 2: drawing of lots', () => {
  assert.equal(lotsKey(42, 'lg-1', 't1'), '0613316991ce0ac31e88d6003e3ff4d5e21bb072ac5f81b42c0cdc6598453293');
  assert.equal(lotsKey(42, 'lg-1', 't2'), 'e3e3a14e22727f936e1f288cf5d02a8a9362b1da13c5432725fc10b2c7955dd9');
  assert.equal(lotsKey(42, 'lg-1', 't3'), 'c8f28e3c2f1eb6c4f636b4f57050e3362a2b39c07fda9b61742a26dd20397028');
});
