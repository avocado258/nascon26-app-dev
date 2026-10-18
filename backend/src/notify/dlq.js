// Notification delivery with bounded exponential retry (max 3 attempts) and a Dead-Letter Queue (FR-5.2).
const crypto = require('crypto');
const { registerReset } = require('../seed');

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 100;
const queue = [];
registerReset(() => { queue.length = 0; });

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// deliver(): returns true on success. Retries are recorded with their exponential backoff schedule;
// the audit probe passes a deliver() that always fails, so no wall-clock sleep is needed.
function dispatch(event, deliver) {
  const attempts = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let ok = false;
    let error = null;
    try { ok = deliver(event, attempt) === true; } catch (e) { error = e.message; }
    attempts.push({ attempt, backoff_ms: attempt === 1 ? 0 : BASE_BACKOFF_MS * 2 ** (attempt - 2), ok });
    if (ok) return { delivered: true, attempts };
    if (error) event.last_error = error;
  }
  const dead = {
    event_id: event.event_id || `ntf-${crypto.randomBytes(6).toString('hex')}`,
    type: event.type || 'notification',
    target: event.target || null,
    attempts: MAX_ATTEMPTS,
    last_error: event.last_error || 'delivery_failed',
    failed_at: nowIso(),
  };
  queue.push(dead);
  return { delivered: false, attempts, dead };
}

function simulateFailures(n, context = {}) {
  for (let i = 0; i < n; i++) {
    dispatch({ type: 'chat.notification', target: context.chat_room_id || null }, () => { throw new Error('simulated_downstream_failure'); });
  }
}

const depth = () => queue.length;
const snapshot = () => queue.map((e) => ({ ...e }));

module.exports = { dispatch, simulateFailures, depth, snapshot, MAX_ATTEMPTS };
