// Public athlete identity + concurrency-safe follow graph (D2 FR-3.1).
const { registerReset } = require('../seed');
const registry = require('../state/registry');
const engine = require('../scoring/engine');
const { ApiError } = require('../utils/errors');

const followers = new Map(); // athlete_id -> Set<follower_id>
registerReset(() => followers.clear());

function athlete(id) {
  const p = registry.state.players.get(id);
  if (!p) throw new ApiError(404, 'PLAYER_NOT_FOUND', `Player ${id} not found`, { player_id: id });
  return p;
}

// Set semantics make follow/unfollow idempotent per (follower, athlete); the handler is synchronous,
// so simultaneous toggles cannot interleave and the count is always the set size (no drift).
function setFollow(athleteId, followerId, follow) {
  athlete(athleteId);
  if (!followers.has(athleteId)) followers.set(athleteId, new Set());
  const set = followers.get(athleteId);
  if (follow) set.add(followerId); else set.delete(followerId);
  return { athlete_id: athleteId, follower_id: followerId, following: follow, follower_count: set.size };
}

// Career record, live/upcoming fixtures and VOD archive are projected from the match event logs.
function profile(id) {
  const p = athlete(id);
  const club = registry.state.clubs.get(p.club_id);
  const career = { played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0 };
  const upcoming = [];
  const live = [];
  const vod = [];
  for (const match of engine.listMatches()) {
    const isHome = match.home_team_id === p.club_id;
    if (!isHome && match.away_team_id !== p.club_id) continue;
    const s = engine.project(match);
    const ref = { match_id: match.match_id, opponent: isHome ? match.away_team_id : match.home_team_id, status: s.status };
    if (s.status === 'upcoming' || s.status === 'postponed') upcoming.push(ref);
    else if (s.status === 'in_progress') live.push({ ...ref, route: `/web/matches/${match.match_id}/live` });
    else if (s.status === 'completed' && s.outcome !== 'undecided') {
      const us = isHome ? s.home : s.away;
      const them = isHome ? s.away : s.home;
      career.played += 1;
      career.scored += us.score;
      career.conceded += them.score;
      if (s.outcome === 'draw') career.drawn += 1;
      else if (s.winner_team_id === p.club_id) career.won += 1;
      else career.lost += 1;
      vod.push({ ...ref, route: `/web/matches/${match.match_id}/vod` });
    }
  }
  return {
    player_id: p.player_id,
    name: p.name,
    club_id: p.club_id,
    club: club.name,
    tenant_id: p.tenant_id,
    follower_count: followers.get(id)?.size || 0,
    career,
    live_matches: live,
    upcoming_fixtures: upcoming,
    vod_archive: vod,
  };
}

module.exports = { profile, setFollow };
