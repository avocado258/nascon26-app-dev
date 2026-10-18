const { ApiError, sendError } = require('../utils/errors');

// Any bearer starting with "guest_" is an anonymous read-only guest (D2 FR-4.2/4.3).
function guestToken(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(guest_\S*)$/i);
  return m ? m[1] : null;
}

function guestWriteError(token) {
  return new ApiError(403, 'GUEST_WRITE_FORBIDDEN', 'Anonymous guest tokens cannot perform write mutations.', { guest_token: token });
}

// Runs before validation so a guest never learns anything about the request shape.
function guardWrite(req, res, next) {
  const token = guestToken(req);
  if (token) return sendError(res, guestWriteError(token));
  next();
}

module.exports = { guestToken, guestWriteError, guardWrite };
