const sportsStore = require('./sports/store');
const registry = require('./state/registry');
const engine = require('./scoring/engine');

// Extra resettable stores register here (Tier 1 modules call registerReset at require time).
const extraResets = [];
function registerReset(fn) { extraResets.push(fn); }

// Seeded live match (D2 5.2): football, league-alpha-1, club-alpha-1 vs club-alpha-2, in_progress, 1-0.
function seedMatchM1() {
  const sport = sportsStore.get('football');
  const firstScoringEvent = Object.keys(sport.scoring_events)[0];
  const steps = [
    { type: 'match_init', payload: { sport_id: 'football', league_id: 'league-alpha-1', home_team_id: 'club-alpha-1', away_team_id: 'club-alpha-2' } },
    { type: 'match_start', payload: {} },
    { type: 'score', payload: { team_id: 'club-alpha-1', event_type: firstScoringEvent } },
  ];
  steps.forEach((s, i) => engine.append({ event_id: `seed-match-m1-${i + 1}`, match_id: 'match-m1', ...s }));
}

// Baseline state (D1 5.5 + D2 5.2). Runs once on boot, so /health can go 200 before the
// grader's first /reset, and again on every POST /audit/v1/reset.
async function seedBaseline({ seed = 42, stock } = {}) {
  sportsStore.reset();
  registry.reset({ seed, stock });
  engine.reset();
  for (const fn of extraResets) await fn();
  seedMatchM1();
}

module.exports = { seedBaseline, registerReset };
