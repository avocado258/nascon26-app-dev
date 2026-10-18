const { ApiError } = require('../utils/errors');

const WITHDRAWAL_POLICIES = ['forfeit_remaining', 'void_all'];

function invalid(message, field) {
  throw new ApiError(400, 'VALIDATION_ERROR', message, { fields: [field] });
}

function generateRoundRobin(teams, params) {
  params = params || {};
  const n = teams.length;
  if (n < 2 || n > 40) invalid('round_robin needs 2-40 teams', 'teams');

  const legs = params.legs === undefined ? 1 : params.legs;
  if (legs !== 1 && legs !== 2) invalid('legs must be 1 or 2', 'params.legs');
  const withdrawalPolicy = params.withdrawal_policy === undefined ? 'forfeit_remaining' : params.withdrawal_policy;
  if (!WITHDRAWAL_POLICIES.includes(withdrawalPolicy)) invalid('unknown withdrawal_policy', 'params.withdrawal_policy');
  const withdrawals = params.withdrawals === undefined ? [] : params.withdrawals;
  if (!Array.isArray(withdrawals)) invalid('withdrawals must be an array', 'params.withdrawals');

  // Circle method: index 0 stays fixed, the rest rotate. Odd n gets a null bye slot.
  const isOdd = n % 2 === 1;
  const arr = isOdd ? [...teams, null] : [...teams];
  const m = arr.length;
  const roundsPerLeg = m - 1;
  const half = m / 2;
  const roundCount = roundsPerLeg * legs;

  // after_round = last global round the team still plays; 0 = never plays.
  const teamIds = new Set(teams);
  const afterRound = new Map();
  for (const w of withdrawals) {
    if (!w || !teamIds.has(w.team_id)) invalid('unknown withdrawal team', 'params.withdrawals');
    if (!Number.isInteger(w.after_round) || w.after_round < 0 || w.after_round > roundCount) {
      invalid('after_round must be within 0..round_count', 'params.withdrawals');
    }
    afterRound.set(w.team_id, w.after_round);
  }

  // Leg-1 pairings. Only the fixed team's match alternates orientation; the
  // rotation already balances everyone else to |home - away| <= 1.
  const leg1 = [];
  let current = [...arr];
  for (let r = 1; r <= roundsPerLeg; r++) {
    const pairs = [];
    const byes = [];
    for (let i = 0; i < half; i++) {
      const a = current[i];
      const b = current[m - 1 - i];
      if (a === null) { byes.push(b); continue; }
      if (b === null) { byes.push(a); continue; }
      pairs.push(i === 0 && r % 2 === 0 ? [b, a] : [a, b]);
    }
    leg1.push({ pairs, byes });
    current = [current[0], current[m - 1], ...current.slice(1, m - 1)];
  }

  const rounds = [];
  for (let leg = 1; leg <= legs; leg++) {
    leg1.forEach(({ pairs, byes }, idx) => {
      const round = (leg - 1) * roundsPerLeg + idx + 1;
      // Leg 2 mirrors leg 1 so every ordered (home, away) pair occurs exactly once.
      const matches = pairs.map(([a, b], j) => {
        const [home, away] = leg === 1 ? [a, b] : [b, a];
        return { match_id: `RR-L${leg}-R${round}-M${j + 1}`, leg, home, away, status: 'scheduled', awarded_to: null };
      });
      rounds.push({ round, matches, byes: [...byes] });
    });
  }

  const summary = { total: 0, scheduled: 0, forfeit: 0, voided: 0 };
  for (const rd of rounds) {
    for (const match of rd.matches) {
      const homeOut = afterRound.has(match.home) && (withdrawalPolicy === 'void_all' || rd.round > afterRound.get(match.home));
      const awayOut = afterRound.has(match.away) && (withdrawalPolicy === 'void_all' || rd.round > afterRound.get(match.away));
      if (withdrawalPolicy === 'void_all' ? (homeOut || awayOut) : (homeOut && awayOut)) {
        match.status = 'voided';
      } else if (homeOut || awayOut) {
        match.status = 'forfeit';
        match.awarded_to = homeOut ? match.away : match.home;
      }
      summary.total++;
      summary[match.status]++;
    }
  }

  return {
    format: 'round_robin',
    legs,
    team_count: n,
    round_count: roundCount,
    rounds,
    summary,
  };
}

module.exports = { generateRoundRobin };
