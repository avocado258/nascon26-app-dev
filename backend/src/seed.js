const sportsStore = require('./sports/store');

// Baseline state (spec 5.5). Runs once on boot, so /health can go 200 before the
// grader's first /reset, and again on every POST /audit/v1/reset.
async function seedBaseline() {
  sportsStore.reset();
  // TODO: wipe tables (matches, events, leagues, rosters, orders, offline-sync records, custom sports)
  // TODO: re-insert baseline: tenants, store product+variants, RBAC scenario, demo users, 4 sports
}

module.exports = { seedBaseline };
