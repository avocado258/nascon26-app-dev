// Append-only, event-sourced match engine (D1 5.9). The projection is rebuilt from the log on every read.
const sportsStore = require('../sports/store');
const bus = require('../realtime/bus');
const { ApiError } = require('../utils/errors');
const { canonical, signDay1 } = require('../utils/sign');

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const TYPES = ['match_init', 'match_start', 'score', 'discipline', 'tiebreak_winner', 'match_end', 'compensation',
  'match_status', 'match_postpone', 'match_cancel', 'match_abandon'];
const COMPENSABLE = ['score', 'discipline', 'tiebreak_winner'];
const STATUS_ALIASES = { match_postpone: 'postponed', match_cancel: 'cancelled', match_abandon: 'abandoned' };
// Allowed manual status changes (FR-1.3 state machine); start/end are separate event types.
const STATUS_TRANSITIONS = {
  postponed: ['upcoming', 'in_progress'],
  cancelled: ['upcoming', 'postponed'],
  abandoned: ['in_progress'],
  upcoming: ['postponed'],
};

const matches = new Map();    // match_id -> { match_id, sport_id, league_id, home_team_id, away_team_id, log: [] }
const eventsById = new Map(); // event_id -> { match_id, entry, request_key, response }

function reset() {
  matches.clear();
  eventsById.clear();
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const invalid = (fields, message = 'Invalid event') => new ApiError(400, 'VALIDATION_ERROR', message, { fields });

function validateEnvelope(body) {
  const fields = [];
  if (!isStr(body.event_id) || !ID_RE.test(body.event_id)) fields.push('event_id');
  if (!isStr(body.match_id) || !ID_RE.test(body.match_id)) fields.push('match_id');
  if (!TYPES.includes(body.type)) fields.push('type');
  if (!isObj(body.payload)) fields.push('payload');
  if (fields.length) throw invalid(fields);

  const p = body.payload;
  const need = (key, ok) => { if (!ok(p[key])) fields.push(`payload.${key}`); };
  switch (body.type) {
    case 'match_init':
      need('sport_id', isStr); need('home_team_id', isStr); need('away_team_id', isStr);
      if (p.league_id !== undefined && p.league_id !== null && !isStr(p.league_id)) fields.push('payload.league_id');
      if (isStr(p.home_team_id) && p.home_team_id === p.away_team_id) fields.push('payload.away_team_id');
      break;
    case 'score': need('team_id', isStr); need('event_type', isStr); break;
    case 'discipline': need('team_id', isStr); need('points', Number.isInteger); break;
    case 'tiebreak_winner': need('team_id', isStr); break;
    case 'compensation': need('compensates', isStr); need('reason', (v) => typeof v === 'string'); break;
    case 'match_status': need('status', (v) => Object.keys(STATUS_TRANSITIONS).includes(v)); break;
    default: break;
  }
  if (fields.length) throw invalid(fields);
}

function project(match) {
  const sport = sportsStore.get(match.sport_id);
  const model = sport.scoring_model;
  const compensatedBy = new Map();
  for (const e of match.log) if (e.type === 'compensation') compensatedBy.set(e.payload.compensates, e.event_id);

  const side = (team_id) => ({ team_id, score: 0, wickets: model === 'innings' ? 0 : null, balls: model === 'innings' ? 0 : null, overs: null, fair_play: 0 });
  const home = side(match.home_team_id);
  const away = side(match.away_team_id);
  const of = (teamId) => (teamId === home.team_id ? home : away);
  let status = 'upcoming';
  let tiebreak = null;

  for (const e of match.log) {
    if (e.type === 'match_start') status = 'in_progress';
    else if (e.type === 'match_end') status = 'completed';
    else if (e.type === 'match_status') status = e.payload.status;
    else if (STATUS_ALIASES[e.type]) status = STATUS_ALIASES[e.type];
    if (!COMPENSABLE.includes(e.type) || compensatedBy.has(e.event_id)) continue;
    const t = of(e.payload.team_id);
    if (e.type === 'discipline') t.fair_play += e.payload.points;
    else if (e.type === 'tiebreak_winner') tiebreak = e.payload.team_id;
    else {
      const def = sport.scoring_events[e.payload.event_type] || {};
      if (model === 'event') t.score += def.points || 0;
      else if (model === 'round') t.score += def.rounds || 0;
      else {
        t.score += def.runs || 0;
        if (def.legal_ball) t.balls += 1;
        if (def.wicket) t.wickets += 1;
      }
    }
  }
  if (model === 'innings') {
    const bpo = sport.periods.balls_per_over;
    for (const t of [home, away]) t.overs = `${Math.floor(t.balls / bpo)}.${t.balls % bpo}`;
  }

  let winner = null;
  if (home.score > away.score) winner = home.team_id;
  else if (away.score > home.score) winner = away.team_id;
  else if (tiebreak) winner = tiebreak;

  let outcome = 'pending';
  if (status === 'completed') {
    if (winner) outcome = winner === home.team_id ? 'home_win' : 'away_win';
    else outcome = sport.draw_allowed ? 'draw' : 'undecided';
  }

  return {
    match_id: match.match_id,
    sport_id: match.sport_id,
    league_id: match.league_id,
    status,
    outcome,
    winner_team_id: winner,
    tiebreak_winner_team_id: tiebreak,
    home,
    away,
    version: match.log.length,
    events: match.log.map((e, i) => ({
      sequence: i + 1, event_id: e.event_id, type: e.type, payload: e.payload, signature: e.signature,
      compensated: compensatedBy.has(e.event_id), compensated_by: compensatedBy.get(e.event_id) || null,
    })),
  };
}

function checkScoringLimits(match, proj, teamId) {
  const sport = sportsStore.get(match.sport_id);
  const t = teamId === proj.home.team_id ? proj.home : proj.away;
  if (sport.scoring_model === 'innings') {
    const p = sport.periods;
    if (t.balls >= p.innings_per_team * p.overs_per_innings * p.balls_per_over || t.wickets >= p.innings_per_team * p.wickets_per_innings) {
      throw new ApiError(409, 'INNINGS_COMPLETE', 'Innings is complete for this team', { team_id: teamId });
    }
  } else if (sport.scoring_model === 'round' && t.score >= (sport.periods.best_of + 1) / 2) {
    throw new ApiError(409, 'SERIES_ALREADY_DECIDED', 'Series is already decided', { team_id: teamId });
  }
}

// Returns { status: 201|200, body }.
function append(body) {
  validateEnvelope(body);
  const requestKey = canonical({ event_id: body.event_id, match_id: body.match_id, type: body.type, payload: body.payload });
  const prior = eventsById.get(body.event_id);
  if (prior) {
    if (prior.request_key === requestKey) return { status: 200, body: prior.response };
    throw new ApiError(409, 'DUPLICATE_EVENT_ID', `Event ${body.event_id} already exists with a different body`, { event_id: body.event_id });
  }

  const { type, payload } = body;
  let match = matches.get(body.match_id);
  if (type === 'match_init') {
    if (match) throw new ApiError(409, 'MATCH_EXISTS', `Match ${body.match_id} already exists`, { match_id: body.match_id });
    if (!sportsStore.exists(payload.sport_id)) throw new ApiError(404, 'SPORT_NOT_FOUND', `Sport ${payload.sport_id} not found`, { sport_id: payload.sport_id });
    match = { match_id: body.match_id, sport_id: payload.sport_id, league_id: payload.league_id || null, home_team_id: payload.home_team_id, away_team_id: payload.away_team_id, log: [] };
  } else {
    if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', `Match ${body.match_id} not found`, { match_id: body.match_id });
    const proj = project(match);
    const sport = sportsStore.get(match.sport_id);
    if (['score', 'discipline', 'tiebreak_winner'].includes(type) && ![match.home_team_id, match.away_team_id].includes(payload.team_id)) {
      throw invalid(['payload.team_id'], 'team_id must be the home or away team');
    }
    if (type === 'score' && !Object.prototype.hasOwnProperty.call(sport.scoring_events, payload.event_type)) {
      throw new ApiError(400, 'UNKNOWN_EVENT_TYPE', `Event type ${payload.event_type} is not defined for ${match.sport_id}`, { event_type: payload.event_type });
    }
    if (type === 'compensation') {
      const target = eventsById.get(payload.compensates);
      if (!target) throw new ApiError(404, 'EVENT_NOT_FOUND', `Event ${payload.compensates} not found`, { event_id: payload.compensates });
      const targetView = target.match_id === match.match_id && proj.events.find((e) => e.event_id === payload.compensates);
      if (!targetView || !COMPENSABLE.includes(targetView.type) || targetView.compensated) {
        throw new ApiError(409, 'INVALID_COMPENSATION', 'Target cannot be compensated', { compensates: payload.compensates });
      }
    } else if (type === 'match_start') {
      if (proj.status !== 'upcoming') throw new ApiError(409, 'ILLEGAL_TRANSITION', `Cannot start a match that is ${proj.status}`, { status: proj.status });
    } else if (type === 'match_end') {
      if (proj.status !== 'in_progress') throw new ApiError(409, 'ILLEGAL_TRANSITION', `Cannot end a match that is ${proj.status}`, { status: proj.status });
      if (proj.home.score === proj.away.score && !sport.draw_allowed && !proj.tiebreak_winner_team_id) {
        throw new ApiError(409, 'TIE_NOT_ALLOWED', 'Draws are not allowed for this sport', { sport_id: match.sport_id });
      }
    } else if (type === 'match_status' || STATUS_ALIASES[type]) {
      const next = type === 'match_status' ? payload.status : STATUS_ALIASES[type];
      if (!STATUS_TRANSITIONS[next].includes(proj.status)) throw new ApiError(409, 'ILLEGAL_TRANSITION', `Cannot move from ${proj.status} to ${next}`, { status: proj.status });
    } else {
      if (proj.status !== 'in_progress') throw new ApiError(409, 'MATCH_NOT_IN_PROGRESS', 'Match is not in progress', { status: proj.status });
      if (type === 'score') checkScoringLimits(match, proj, payload.team_id);
    }
  }

  const entry = { event_id: body.event_id, type, payload, signature: signDay1(body.event_id, payload) };
  match.log.push(entry);
  matches.set(match.match_id, match);
  const response = { event_id: body.event_id, match_id: match.match_id, type, sequence: match.log.length, match_version: match.log.length, signature: entry.signature };
  eventsById.set(body.event_id, { match_id: match.match_id, request_key: requestKey, response });
  bus.emit('match', match.match_id);
  return { status: 201, body: response };
}

function score(matchId) {
  const match = matches.get(matchId);
  if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', `Match ${matchId} not found`, { match_id: matchId });
  return project(match);
}

const getMatch = (matchId) => matches.get(matchId);
const listMatches = () => [...matches.values()];

module.exports = { reset, append, score, getMatch, listMatches, project };
