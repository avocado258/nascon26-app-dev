// Member sessions: HS256 JWTs with the algorithm pinned (alg:none and tampered tokens are rejected).
const jwt = require('jsonwebtoken');
const registry = require('../state/registry');
const { ApiError, sendError } = require('../utils/errors');
const { guestToken } = require('./guest');

const secret = () => process.env.JWT_SECRET || 'nascon-dev-jwt-secret';

function issue(user) {
  return jwt.sign({ sub: user.user_id, role: user.role, tenant_id: user.tenant_id }, secret(), { algorithm: 'HS256', expiresIn: '2h' });
}

function verify(token) {
  let claims;
  try {
    claims = jwt.verify(token, secret(), { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const user = registry.state.users.get(claims.sub);
  // Erased users (NFR-9) lose every token issued before the erasure.
  if (!user || (user.tokens_revoked_at && claims.iat * 1000 <= user.tokens_revoked_at)) return null;
  return user;
}

const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', 'A valid member token is required', {});

function requireMember(req, res, next) {
  if (guestToken(req)) return next(); // guardWrite decides for guests
  const m = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i);
  const user = m && verify(m[1]);
  if (!user) return sendError(res, unauthenticated());
  req.user = user;
  next();
}

function login(email, password) {
  const userId = registry.state.usersByEmail.get(String(email || '').toLowerCase());
  const user = userId && registry.state.users.get(userId);
  if (!user || user.anonymized || user.password_hash !== registry.hashPassword(String(password || ''))) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid email or password', {});
  }
  return { token: issue(user), user_id: user.user_id, role: user.role, tenant_id: user.tenant_id, player_id: user.player_id || null };
}

module.exports = { issue, verify, requireMember, login };
