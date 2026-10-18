// Five-tier RBAC as policy-as-code (D1 FR-5.1, 5.13). One table maps each probe to an allow rule;
// tenant isolation is absolute for every non-super-admin principal.
const express = require('express');
const registry = require('../state/registry');
const auth = require('../auth/jwt');
const { guestToken, guestWriteError } = require('../auth/guest');
const { ApiError, sendError } = require('../utils/errors');

const isSuper = (u) => u.role === 'super_admin';
const sameTenant = (u, tenantId) => u.tenant_id === tenantId;

// target(params) -> { tenant_id, ...entity } | null (null => 404)
const TARGETS = {
  none: () => ({}),
  league: (id) => registry.state.leagues.get(id) || null,
  club: (id) => registry.state.clubs.get(id) || null,
  player: (id) => registry.state.players.get(id) || null,
};
const NOT_FOUND = { league: 'LEAGUE_NOT_FOUND', club: 'NOT_FOUND', player: 'PLAYER_NOT_FOUND' };

const POLICY = {
  P1_create_tenant: { target: 'none', allow: (u) => isSuper(u) },
  P2_league_fixtures: { target: 'league', allow: (u, l) => isSuper(u) || (u.role === 'league_organizer' && sameTenant(u, l.tenant_id) && (u.league_ids || []).includes(l.league_id)) },
  P3_club_roster: { target: 'club', allow: (u, c) => isSuper(u) || (u.role === 'club_manager' && sameTenant(u, c.tenant_id) && (u.club_ids || []).includes(c.club_id)) },
  P4_club_products: { target: 'club', allow: (u, c) => isSuper(u) || (u.role === 'club_manager' && sameTenant(u, c.tenant_id) && (u.club_ids || []).includes(c.club_id)) },
  P5_update_player: {
    target: 'player',
    allow: (u, p) => isSuper(u)
      || (u.role === 'club_manager' && sameTenant(u, p.tenant_id) && (u.club_ids || []).includes(p.club_id))
      || (u.role === 'player' && u.player_id === p.player_id),
  },
  P6_read_club: { target: 'club', allow: (u, c) => isSuper(u) || sameTenant(u, c.tenant_id) },
  P7_platform_config: { target: 'none', allow: (u) => isSuper(u) },
};

function probe(name, param) {
  const rule = POLICY[name];
  return (req, res) => {
    try {
      const guest = guestToken(req);
      if (guest && req.method !== 'GET') throw guestWriteError(guest);
      const m = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
      const user = m && !guest && auth.verify(m[1]);
      if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'A valid token is required', {});
      const id = param ? req.params[param] : null;
      const target = TARGETS[rule.target](id);
      if (!target) throw new ApiError(404, NOT_FOUND[rule.target], `${rule.target} ${id} not found`, { [`${rule.target}_id`]: id });
      if (!rule.allow(user, target)) throw new ApiError(403, 'FORBIDDEN', 'Not allowed for this role or tenant', { role: user.role });
      res.status(200).json({ authorized: true });
    } catch (err) {
      sendError(res, err);
    }
  };
}

const router = express.Router();
router.post('/tenants', probe('P1_create_tenant'));
router.post('/leagues/:league_id/fixtures', probe('P2_league_fixtures', 'league_id'));
router.post('/clubs/:club_id/roster', probe('P3_club_roster', 'club_id'));
router.post('/clubs/:club_id/products', probe('P4_club_products', 'club_id'));
router.patch('/players/:player_id', probe('P5_update_player', 'player_id'));
router.get('/clubs/:club_id', probe('P6_read_club', 'club_id'));
router.get('/platform/config', probe('P7_platform_config'));

const ROLE_USERS = { super_admin: 'user-admin', league_organizer: 'user-organizer', club_manager: 'user-manager', player: 'player-alpha-1', viewer: 'user-viewer' };

function matrix() {
  const tokens = {};
  for (const [role, userId] of Object.entries(ROLE_USERS)) tokens[role] = auth.issue(registry.state.users.get(userId));
  return {
    tokens,
    context: {
      tenant_id: 'tenant-alpha', foreign_tenant_id: 'tenant-beta',
      own_league_id: 'league-alpha-1', other_league_id: 'league-alpha-2', foreign_league_id: 'league-beta-1',
      own_club_id: 'club-alpha-1', other_club_id: 'club-alpha-2', foreign_club_id: 'club-beta-1',
      own_player_id: 'player-alpha-1', other_player_id: 'player-alpha-2', foreign_player_id: 'player-beta-1',
    },
  };
}

module.exports = { router, matrix, POLICY };
