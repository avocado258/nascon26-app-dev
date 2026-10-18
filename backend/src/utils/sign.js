const crypto = require('crypto');

// Canonical JSON (D1 5.3 / D2 5.3): recursively sorted keys, "," and ":" separators,
// no whitespace, non-ASCII left unescaped, array order preserved.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function canonical(obj) {
  return JSON.stringify(sortKeys(obj));
}

function hmac(salt, id, payload) {
  return crypto.createHmac('sha256', Buffer.from(salt || '', 'utf8'))
    .update(Buffer.from(`${id}|${canonical(payload)}`, 'utf8'))
    .digest('hex');
}

// Salts are read at call time so they always come from the environment.
const signDay1 = (id, payload) => hmac(process.env.DAY1_SALT, id, payload);
const signDay2 = (id, payload) => hmac(process.env.DAY2_SALT, id, payload);

function lotsKey(seed, leagueId, teamId) {
  return crypto.createHash('sha256').update(`${seed}|${leagueId}|${teamId}`, 'utf8').digest('hex');
}

module.exports = { canonical, hmac, signDay1, signDay2, lotsKey };
