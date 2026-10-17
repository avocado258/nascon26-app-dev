CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS sports (
  sport_id TEXT PRIMARY KEY,
  config JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS leagues (
  league_id TEXT PRIMARY KEY,
  sport_id TEXT REFERENCES sports(sport_id),
  config JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY,
  league_id TEXT,
  sport_id TEXT,
  status TEXT DEFAULT 'upcoming',
  home_team_id TEXT,
  away_team_id TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  match_id TEXT REFERENCES matches(match_id),
  event_id TEXT UNIQUE NOT NULL,
  sequence INT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature TEXT NOT NULL,
  compensated BOOLEAN DEFAULT FALSE,
  compensated_by TEXT
);
CREATE TABLE IF NOT EXISTS clubs (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT);
CREATE TABLE IF NOT EXISTS squads (squad_id TEXT PRIMARY KEY, club_id TEXT, league_id TEXT);
CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY, squad_id TEXT, name TEXT, position TEXT, role TEXT
);
CREATE TABLE IF NOT EXISTS roster_audit (
  audit_id TEXT PRIMARY KEY, player_id TEXT, action TEXT, details JSONB, who TEXT, when_ts TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS products (product_id TEXT PRIMARY KEY, tenant_id TEXT, config JSONB);
CREATE TABLE IF NOT EXISTS variants (
  variant_id TEXT PRIMARY KEY, product_id TEXT, price_minor INT, stock INT, reserved INT DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY, customer_id TEXT, status TEXT, payload JSONB, signature TEXT
);
CREATE TABLE IF NOT EXISTS offline_sync_log (
  device_id TEXT, action_id TEXT, PRIMARY KEY (device_id, action_id)
);