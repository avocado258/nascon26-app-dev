class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function errorBody(code, message, details = {}) {
  return { error: { code, message, details } };
}

function sendError(res, err) {
  if (err instanceof ApiError) {
    return res.status(err.status).json(errorBody(err.code, err.message, err.details));
  }
  console.error(err);
  return res.status(500).json(errorBody('INTERNAL_ERROR', 'Unexpected error'));
}

module.exports = { ApiError, errorBody, sendError };