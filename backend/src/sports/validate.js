const { ApiError } = require('../utils/errors');

const ID_RE = /^[a-z0-9_-]{2,40}$/;
const EVENT_KEY_RE = /^[a-z0-9_]{1,40}$/;
const SCORING_MODELS = ['event', 'innings', 'round'];
const OVERTIME_POLICIES = ['none', 'extra_time', 'shootout', 'golden_score', 'super_over'];
const TIE_BREAK_TOKENS = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];

function fail(fields) {
  throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid sport config', { fields });
}

function validateSportPayload(body) {
  const fields = [];
  if (typeof body.sport_id !== 'string' || !ID_RE.test(body.sport_id)) fields.push('sport_id');
  if (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 80) fields.push('name');
  if (!SCORING_MODELS.includes(body.scoring_model)) fields.push('scoring_model');
  if (typeof body.draw_allowed !== 'boolean') fields.push('draw_allowed');

  // periods — shape depends on scoring_model
  if (typeof body.periods !== 'object' || body.periods === null) {
    fields.push('periods');
  } else if (body.scoring_model === 'event') {
    if (!(Number.isInteger(body.periods.count) && body.periods.count >= 1)) fields.push('periods.count');
    if (!(Number.isInteger(body.periods.duration_minutes) && body.periods.duration_minutes >= 1)) fields.push('periods.duration_minutes');
  } else if (body.scoring_model === 'innings') {
    const p = body.periods;
    if (!(Number.isInteger(p.innings_per_team) && p.innings_per_team >= 1)) fields.push('periods.innings_per_team');
    if (!(Number.isInteger(p.overs_per_innings) && p.overs_per_innings >= 1)) fields.push('periods.overs_per_innings');
    if (!(Number.isInteger(p.balls_per_over) && p.balls_per_over >= 1)) fields.push('periods.balls_per_over');
    if (!(Number.isInteger(p.wickets_per_innings) && p.wickets_per_innings >= 1)) fields.push('periods.wickets_per_innings');
  } else if (body.scoring_model === 'round') {
    if (!(Number.isInteger(body.periods.best_of) && body.periods.best_of >= 1 && body.periods.best_of % 2 === 1)) {
      fields.push('periods.best_of');
    }
  }

  // scoring_events
  if (typeof body.scoring_events !== 'object' || body.scoring_events === null || Object.keys(body.scoring_events).length < 1) {
    fields.push('scoring_events');
  } else {
    for (const [key, val] of Object.entries(body.scoring_events)) {
      if (!EVENT_KEY_RE.test(key)) { fields.push(`scoring_events.${key}`); continue; }
      if (body.scoring_model === 'event') {
        if (!(Number.isInteger(val.points) && val.points >= 1)) fields.push(`scoring_events.${key}.points`);
      } else if (body.scoring_model === 'innings') {
        if (!(Number.isInteger(val.runs) && val.runs >= 0)) fields.push(`scoring_events.${key}.runs`);
        if (typeof val.legal_ball !== 'boolean') fields.push(`scoring_events.${key}.legal_ball`);
        if (typeof val.wicket !== 'boolean') fields.push(`scoring_events.${key}.wicket`);
      } else if (body.scoring_model === 'round') {
        if (!(Number.isInteger(val.rounds) && val.rounds >= 1)) fields.push(`scoring_events.${key}.rounds`);
      }
    }
  }

  // overtime
  if (typeof body.overtime !== 'object' || body.overtime === null || !OVERTIME_POLICIES.includes(body.overtime.policy)) {
    fields.push('overtime.policy');
  } else if (body.overtime.duration_minutes !== undefined && !(Number.isInteger(body.overtime.duration_minutes) && body.overtime.duration_minutes >= 0)) {
    fields.push('overtime.duration_minutes');
  }

  // tie_break_order — optional
  if (body.tie_break_order !== undefined) {
    if (!Array.isArray(body.tie_break_order) || !body.tie_break_order.every((t) => TIE_BREAK_TOKENS.includes(t))) {
      fields.push('tie_break_order');
    }
  }

  // roster
  if (typeof body.roster !== 'object' || body.roster === null) {
    fields.push('roster');
  } else {
    const r = body.roster;
    if (!(Number.isInteger(r.min_squad_size) && r.min_squad_size >= 1)) fields.push('roster.min_squad_size');
    if (!(Number.isInteger(r.max_squad_size) && r.max_squad_size >= 1)) fields.push('roster.max_squad_size');
    if (Number.isInteger(r.min_squad_size) && Number.isInteger(r.max_squad_size) && r.min_squad_size > r.max_squad_size) {
      fields.push('roster.min_squad_size');
    }
    if (r.required_positions !== undefined && (typeof r.required_positions !== 'object' || r.required_positions === null)) {
      fields.push('roster.required_positions');
    }
  }

  if (fields.length) fail(fields);
}

module.exports = { validateSportPayload };