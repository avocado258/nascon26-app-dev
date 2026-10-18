const { ApiError } = require('../utils/errors');

function seedOrder(size) {
  if (size === 2) return [1, 2];
  const prev = seedOrder(size / 2);
  const out = [];
  for (const s of prev) out.push(s, size + 1 - s);
  return out;
}

function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function generateSingleElim(teams, params = {}) {
  const n = teams.length;
  if (n < 2 || n > 128) throw new ApiError(400, 'VALIDATION_ERROR', 'single_elim needs 2-128 teams', { fields: ['teams'] });

  const B = nextPowerOf2(n);
  const order = seedOrder(B); // array of seed numbers (1-indexed), length B
  const totalRounds = Math.log2(B);

  const rounds = [];
  const matchById = new Map();

  // Round 1
  const r1matches = [];
  for (let i = 0; i < B / 2; i++) {
    const seedHomeIdx = order[2 * i];
    const seedAwayIdx = order[2 * i + 1];
    const homeTeam = seedHomeIdx <= n ? teams[seedHomeIdx - 1] : null;
    const awayTeam = seedAwayIdx <= n ? teams[seedAwayIdx - 1] : null;
    const bye = homeTeam === null || awayTeam === null;
    const match = {
      match_id: `R1M${i + 1}`, bracket: 'main', round: 1, index: i + 1,
      home: homeTeam, away: awayTeam, home_seed: seedHomeIdx, away_seed: seedAwayIdx,
      status: bye ? 'completed' : 'scheduled',
      winner: bye ? (homeTeam || awayTeam) : null,
      loser: null, bye,
      winner_to: null, loser_to: null,
    };
    r1matches.push(match);
    matchById.set(match.match_id, match);
  }
  rounds.push({ round: 1, matches: r1matches });

  // Subsequent rounds
  for (let r = 2; r <= totalRounds; r++) {
    const count = B / Math.pow(2, r);
    const matches = [];
    for (let i = 0; i < count; i++) {
      const match = {
        match_id: `R${r}M${i + 1}`, bracket: 'main', round: r, index: i + 1,
        home: null, away: null, status: 'scheduled', winner: null, loser: null, bye: false,
        winner_to: r === totalRounds ? null : { match_id: `R${r + 1}M${Math.ceil((i + 1) / 2)}`, slot: (i + 1) % 2 === 1 ? 'home' : 'away' },
        loser_to: null,
      };
      matches.push(match);
      matchById.set(match.match_id, match);
    }
    rounds.push({ round: r, matches });
  }
  // wire winner_to for round 1 and propagate byes
  for (const m of r1matches) {
    if (m.round < totalRounds) {
      const targetRound = rounds[1].matches;
      const target = targetRound[Math.ceil(m.index / 2) - 1];
      m.winner_to = { match_id: target.match_id, slot: m.index % 2 === 1 ? 'home' : 'away' };
    }
  }
  function propagate(match) {
    if (match.winner && match.winner_to) {
      const target = matchById.get(match.winner_to.match_id);
      target[match.winner_to.slot] = match.winner;
      if (target.home && target.away) target.status = 'scheduled';
    }
  }
  for (const m of r1matches) propagate(m);

  // third place match
  let thirdPlace = null;
  if (params.third_place_match) {
    const semiRound = rounds[totalRounds - 2]; // second to last
    if (semiRound) {
      thirdPlace = {
        match_id: 'TP', bracket: 'third_place', round: totalRounds - 1, index: 1,
        home: null, away: null, status: 'scheduled', winner: null, loser: null, bye: false,
        winner_to: null, loser_to: null,
      };
      semiRound.matches.forEach((m, idx) => {
        m.loser_to = { match_id: 'TP', slot: idx === 0 ? 'home' : 'away' };
      });
      matchById.set('TP', thirdPlace);
    }
  }

  // Apply results
  for (const result of params.results || []) {
    const match = matchById.get(result.match_id);
    if (!match) throw new ApiError(400, 'VALIDATION_ERROR', 'unknown match_id in results', { fields: ['params.results'] });
    if (result.winner !== match.home && result.winner !== match.away) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'winner not a participant', { fields: ['params.results'] });
    }
    match.winner = result.winner;
    match.loser = result.winner === match.home ? match.away : match.home;
    match.status = 'completed';
    propagate(match);
    if (match.loser_to) {
      const target = matchById.get(match.loser_to.match_id);
      target[match.loser_to.slot] = match.loser;
      if (target.home && target.away) target.status = 'scheduled';
    }
  }

  const response = { format: 'single_elim', bracket_size: B, rounds };
  if (thirdPlace) response.rounds.push({ round: totalRounds + 1, matches: [thirdPlace] }); // adjust if spec wants it inline differently
  return response;
}

module.exports = { generateSingleElim, seedOrder, nextPowerOf2 };