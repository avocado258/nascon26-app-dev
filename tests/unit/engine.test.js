const test = require('node:test');
const assert = require('node:assert/strict');
const sportsStore = require('../../backend/src/sports/store');
const engine = require('../../backend/src/scoring/engine');
const { seedBaseline } = require('../../backend/src/seed');

let n = 0;
const ev = (match_id, type, payload = {}) => engine.append({ event_id: `e${++n}`, match_id, type, payload });
const code = (fn) => { try { fn(); return null; } catch (e) { return `${e.status} ${e.code}`; } };

function fresh() {
  sportsStore.reset();
  engine.reset();
}

test('seed creates match-m1 in progress at 1-0', async () => {
  await seedBaseline();
  const s = engine.score('match-m1');
  assert.equal(s.status, 'in_progress');
  assert.deepEqual([s.home.team_id, s.home.score, s.away.team_id, s.away.score], ['club-alpha-1', 1, 'club-alpha-2', 0]);
  assert.equal(s.league_id, 'league-alpha-1');
});

test('event model lifecycle, compensation and outcome', () => {
  fresh();
  assert.equal(ev('m1', 'match_init', { sport_id: 'football', home_team_id: 'a', away_team_id: 'b' }).status, 201);
  assert.equal(code(() => ev('m1', 'score', { team_id: 'a', event_type: 'goal' })), '409 MATCH_NOT_IN_PROGRESS');
  ev('m1', 'match_start');
  assert.equal(code(() => ev('m1', 'match_start')), '409 ILLEGAL_TRANSITION');
  const goal = ev('m1', 'score', { team_id: 'a', event_type: 'goal' });
  assert.equal(goal.body.sequence, 3);
  assert.match(goal.body.signature, /^[0-9a-f]{64}$/);
  assert.equal(code(() => ev('m1', 'score', { team_id: 'zz', event_type: 'goal' })), '400 VALIDATION_ERROR');
  assert.equal(code(() => ev('m1', 'score', { team_id: 'a', event_type: 'try' })), '400 UNKNOWN_EVENT_TYPE');
  ev('m1', 'discipline', { team_id: 'b', points: -1 });
  ev('m1', 'match_end');
  assert.equal(engine.score('m1').outcome, 'home_win');
  ev('m1', 'compensation', { compensates: goal.body.event_id, reason: 'VAR' });
  const s = engine.score('m1');
  assert.equal(s.outcome, 'draw');
  assert.equal(s.away.fair_play, -1);
  assert.equal(s.events[2].compensated, true);
  assert.equal(code(() => ev('m1', 'compensation', { compensates: goal.body.event_id, reason: 'again' })), '409 INVALID_COMPENSATION');
  assert.equal(code(() => ev('m1', 'compensation', { compensates: 'nope', reason: 'x' })), '404 EVENT_NOT_FOUND');
});

test('idempotency, duplicates and missing streams', () => {
  fresh();
  const body = { event_id: 'x1', match_id: 'm2', type: 'match_init', payload: { sport_id: 'football', home_team_id: 'a', away_team_id: 'b' } };
  assert.equal(engine.append(body).status, 201);
  assert.equal(engine.append(body).status, 200);
  assert.equal(code(() => engine.append({ ...body, payload: { ...body.payload, away_team_id: 'c' } })), '409 DUPLICATE_EVENT_ID');
  assert.equal(code(() => ev('m2', 'match_init', { sport_id: 'football', home_team_id: 'a', away_team_id: 'b' })), '409 MATCH_EXISTS');
  assert.equal(code(() => ev('nope', 'match_start')), '404 MATCH_NOT_FOUND');
  assert.equal(code(() => ev('m3', 'match_init', { sport_id: 'curling', home_team_id: 'a', away_team_id: 'b' })), '404 SPORT_NOT_FOUND');
  assert.equal(code(() => engine.append({ event_id: 'bad|id', match_id: 'm2', type: 'match_start', payload: {} })), '400 VALIDATION_ERROR');
});

test('no draws without a tiebreak winner; tiebreak decides', () => {
  fresh();
  ev('b1', 'match_init', { sport_id: 'basketball', home_team_id: 'a', away_team_id: 'b' });
  ev('b1', 'match_start');
  assert.equal(code(() => ev('b1', 'match_end')), '409 TIE_NOT_ALLOWED');
  ev('b1', 'tiebreak_winner', { team_id: 'b' });
  ev('b1', 'match_end');
  const s = engine.score('b1');
  assert.equal(s.outcome, 'away_win');
  assert.equal(s.winner_team_id, 'b');
});

test('innings and round model limits come from config', () => {
  fresh();
  sportsStore.create('mini', { sport_id: 'mini', name: 'Mini', scoring_model: 'innings', draw_allowed: true,
    periods: { innings_per_team: 1, overs_per_innings: 1, balls_per_over: 2, wickets_per_innings: 1 },
    scoring_events: { hit: { runs: 2, legal_ball: true, wicket: false }, extra: { runs: 1, legal_ball: false, wicket: false } },
    overtime: { policy: 'none' }, roster: { min_squad_size: 1, max_squad_size: 2 } });
  ev('c1', 'match_init', { sport_id: 'mini', home_team_id: 'a', away_team_id: 'b' });
  ev('c1', 'match_start');
  ev('c1', 'score', { team_id: 'a', event_type: 'hit' });
  ev('c1', 'score', { team_id: 'a', event_type: 'extra' });
  ev('c1', 'score', { team_id: 'a', event_type: 'hit' });
  assert.equal(code(() => ev('c1', 'score', { team_id: 'a', event_type: 'hit' })), '409 INNINGS_COMPLETE');
  const s = engine.score('c1');
  assert.deepEqual([s.home.score, s.home.balls, s.home.overs, s.away.wickets], [5, 2, '1.0', 0]);

  ev('r1', 'match_init', { sport_id: 'esports', home_team_id: 'a', away_team_id: 'b' });
  ev('r1', 'match_start');
  ev('r1', 'score', { team_id: 'a', event_type: 'round_win' });
  ev('r1', 'score', { team_id: 'a', event_type: 'round_win' });
  assert.equal(code(() => ev('r1', 'score', { team_id: 'a', event_type: 'round_win' })), '409 SERIES_ALREADY_DECIDED');
});

test('status events: postpone, cancel, abandon', () => {
  fresh();
  ev('s1', 'match_init', { sport_id: 'football', home_team_id: 'a', away_team_id: 'b' });
  ev('s1', 'match_start');
  ev('s1', 'match_status', { status: 'postponed' });
  assert.equal(engine.score('s1').status, 'postponed');
  assert.equal(code(() => ev('s1', 'match_end')), '409 ILLEGAL_TRANSITION');
  ev('s1', 'match_cancel');
  assert.equal(engine.score('s1').status, 'cancelled');
  assert.equal(code(() => ev('s1', 'match_status', { status: 'bogus' })), '400 VALIDATION_ERROR');
});
