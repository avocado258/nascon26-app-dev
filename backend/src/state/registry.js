const crypto = require('crypto');

// Baseline entities shared by Phase I and Phase II modules (D1 5.5, D2 5.2). Rebuilt by reset().
const state = {
  tenants: new Map(),
  leagues: new Map(),
  clubs: new Map(),
  players: new Map(),
  products: new Map(),
  variants: new Map(),
  discounts: new Map(),
  users: new Map(),        // user_id -> user
  usersByEmail: new Map(), // email -> user_id
  carts: new Map(),        // user_id -> { items: [{ variant_id, quantity }] }
  guestTokens: new Map(),  // token -> { token, merged, merge_key, response, anonymized }
  lotsSeed: 42,
};

const DEMO_PASSWORD = 'Nascon@26';
const DEFAULT_STOCK = { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 };

function hashPassword(password) {
  return crypto.createHash('sha256').update(`nascon-demo|${password}`).digest('hex');
}

function addUser(user) {
  state.users.set(user.user_id, { ...user, password_hash: hashPassword(DEMO_PASSWORD), anonymized: false });
  if (user.email) state.usersByEmail.set(user.email, user.user_id);
  state.carts.set(user.user_id, { items: [] });
}

function reset({ seed = 42, stock = DEFAULT_STOCK } = {}) {
  for (const m of Object.values(state)) if (m instanceof Map) m.clear();
  state.lotsSeed = seed;

  state.tenants.set('tenant-alpha', { tenant_id: 'tenant-alpha', name: 'Alpha Sports' });
  state.tenants.set('tenant-beta', { tenant_id: 'tenant-beta', name: 'Beta Athletics' });

  for (const [league_id, tenant_id] of [['league-alpha-1', 'tenant-alpha'], ['league-alpha-2', 'tenant-alpha'], ['league-beta-1', 'tenant-beta']]) {
    state.leagues.set(league_id, { league_id, tenant_id });
  }
  for (const [club_id, tenant_id, name] of [['club-alpha-1', 'tenant-alpha', 'Alpha One FC'], ['club-alpha-2', 'tenant-alpha', 'Alpha Two FC'], ['club-beta-1', 'tenant-beta', 'Beta One FC']]) {
    state.clubs.set(club_id, { club_id, tenant_id, name });
  }
  for (const [player_id, club_id, name] of [
    ['player-alpha-1', 'club-alpha-1', 'Alpha Player One'],
    ['player-alpha-2', 'club-alpha-2', 'Alpha Player Two'],
    ['player-beta-1', 'club-beta-1', 'Beta Player One'],
    ['player-beta-2', 'club-beta-1', 'Beta Player Two'],
  ]) {
    state.players.set(player_id, { player_id, club_id, tenant_id: state.clubs.get(club_id).tenant_id, name });
  }

  state.products.set('prod-jersey-001', { product_id: 'prod-jersey-001', tenant_id: 'tenant-alpha', name: 'Club Jersey 2026' });
  const stockMap = { ...DEFAULT_STOCK, ...stock };
  for (const variant_id of Object.keys(stockMap)) {
    state.variants.set(variant_id, {
      variant_id, product_id: 'prod-jersey-001', size: variant_id.split('-').pop(),
      price_minor: 450000, currency: 'PKR', stock: stockMap[variant_id], reserved: 0,
    });
  }
  state.discounts.set('WELCOME10', { code: 'WELCOME10', percent: 10 });

  // Demo accounts (D1 8.3). Each seeded player is also a registered user with a cart (D2 5.2).
  addUser({ user_id: 'user-admin', email: 'admin@nascon.test', role: 'super_admin', tenant_id: null });
  addUser({ user_id: 'user-organizer', email: 'organizer@nascon.test', role: 'league_organizer', tenant_id: 'tenant-alpha', league_ids: ['league-alpha-1'] });
  addUser({ user_id: 'user-manager', email: 'manager@nascon.test', role: 'club_manager', tenant_id: 'tenant-alpha', club_ids: ['club-alpha-1'] });
  addUser({ user_id: 'user-viewer', email: 'viewer@nascon.test', role: 'viewer', tenant_id: 'tenant-alpha' });
  for (const p of state.players.values()) {
    addUser({ user_id: p.player_id, email: p.player_id === 'player-alpha-1' ? 'player@nascon.test' : null, role: 'player', tenant_id: p.tenant_id, player_id: p.player_id });
  }

  state.guestTokens.set('guest_anon_tok_7721', { token: 'guest_anon_tok_7721', merged: false, merge_key: null, response: null, anonymized: false });
}

module.exports = { state, reset, hashPassword, DEFAULT_STOCK };
