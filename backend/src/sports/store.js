// In-memory store, wiped on /audit/v1/reset
const sports = new Map();

const DEFAULT_SPORTS = {
  football: {
    sport_id: 'football', name: 'Football', scoring_model: 'event',
    periods: { count: 2, duration_minutes: 45 },
    scoring_events: { goal: { points: 1 } },
    draw_allowed: true,
    overtime: { policy: 'none' },
    roster: { min_squad_size: 11, max_squad_size: 25, required_positions: { gk: 1 } },
  },
  basketball: {
    sport_id: 'basketball', name: 'Basketball', scoring_model: 'event',
    periods: { count: 4, duration_minutes: 12 },
    scoring_events: { free_throw: { points: 1 }, two_pointer: { points: 2 }, three_pointer: { points: 3 } },
    draw_allowed: false,
    overtime: { policy: 'extra_time', duration_minutes: 5 },
    roster: { min_squad_size: 5, max_squad_size: 15, required_positions: {} },
  },
  cricket: {
    sport_id: 'cricket', name: 'Cricket', scoring_model: 'innings',
    periods: { innings_per_team: 1, overs_per_innings: 20, balls_per_over: 6, wickets_per_innings: 10 },
    scoring_events: {
      dot_ball: { runs: 0, legal_ball: true, wicket: false },
      single: { runs: 1, legal_ball: true, wicket: false },
      two: { runs: 2, legal_ball: true, wicket: false },
      four: { runs: 4, legal_ball: true, wicket: false },
      six: { runs: 6, legal_ball: true, wicket: false },
      wide: { runs: 1, legal_ball: false, wicket: false },
      no_ball: { runs: 1, legal_ball: false, wicket: false },
      wicket: { runs: 0, legal_ball: true, wicket: true },
    },
    draw_allowed: true,
    overtime: { policy: 'super_over' },
    roster: { min_squad_size: 11, max_squad_size: 18, required_positions: { wicketkeeper: 1 } },
  },
  esports: {
    sport_id: 'esports', name: 'Esports', scoring_model: 'round',
    periods: { best_of: 3 },
    scoring_events: { round_win: { rounds: 1 } },
    draw_allowed: false,
    overtime: { policy: 'none' },
    roster: { min_squad_size: 5, max_squad_size: 8, required_positions: {} },
  },
};

function reset() {
  sports.clear();
  for (const [id, cfg] of Object.entries(DEFAULT_SPORTS)) sports.set(id, cfg);
}

function get(sportId) {
  return sports.get(sportId);
}

function create(sportId, config) {
  sports.set(sportId, config);
}

function exists(sportId) {
  return sports.has(sportId);
}

function listIds() {
  return Array.from(sports.keys());
}

module.exports = { reset, get, create, exists, listIds };