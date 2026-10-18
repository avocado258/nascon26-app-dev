// Synchronous pre-broadcast chat moderation (D2 FR-5.3, 5.8): leetspeak profanity masking and flood rejection.
const dlq = require('../notify/dlq');
const { ApiError } = require('../utils/errors');
const { signDay2 } = require('../utils/sign');

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const SEPARATORS = /[_.\-*]/g;
const LEET = { '@': 'a', '0': 'o', '3': 'e', '$': 's', '1': 'i' };

function baseNormalize(s) {
  return s.toLowerCase().replace(ZERO_WIDTH, '').replace(SEPARATORS, '').replace(/[@031$]/g, (c) => LEET[c]);
}

// "!" is ambiguous (s!c@m → scam, sh!t → shit), so both readings are tried.
function candidates(core) {
  const base = baseNormalize(core);
  return [base.replace(/!/g, 'i'), base.replace(/!/g, '')];
}

const DICTIONARY = new Set(['badword', 'bad_word', 'porn', 'scam', 'fuck', 'shit', 'bitch', 'asshole', 'idiot_spam']
  .map((w) => baseNormalize(w)));

// Splits a whitespace-free token into leading punctuation, core, and trailing sentence punctuation.
function splitToken(token) {
  const lead = token.match(/^[^A-Za-z0-9@$!*_.\-]*/)[0];
  const rest = token.slice(lead.length);
  const trail = rest.match(/[!?.,;:"')\]]*$/)[0];
  let core = rest.slice(0, rest.length - trail.length);
  // A trailing "!" may be part of the word itself (e.g. "sh!t!"): keep the longest core that matches.
  if (trail && !isProfane(core)) {
    for (let k = 1; k <= trail.length; k++) {
      const longer = rest.slice(0, rest.length - trail.length + k);
      if (isProfane(longer)) return { lead, core: longer, trail: trail.slice(k) };
    }
  }
  return { lead, core, trail };
}

function isProfane(core) {
  return core.length > 0 && candidates(core).some((c) => DICTIONARY.has(c));
}

function mask(text) {
  let hit = false;
  const out = text.split(/(\s+)/).map((part) => {
    if (!part || /^\s+$/.test(part)) return part;
    const { lead, core, trail } = splitToken(part);
    if (!isProfane(core)) return part;
    hit = true;
    return `${lead}***${trail}`;
  }).join('');
  return { text: out, flagged: hit };
}

// ≥4 identical consecutive characters (case-insensitive) or ≥3 consecutive "!"/"?".
const isFlood = (text) => /(.)\1{3,}/isu.test(text) || /[!?]{3,}/.test(text);

function moderate(message) {
  if (isFlood(message.text)) return { action: 'drop', reason: 'flood_character_repeat' };
  const m = mask(message.text);
  if (m.flagged) return { action: 'flag', text: m.text, reason: 'profanity_leetspeak' };
  return { action: 'pass', text: message.text, reason: null };
}

const isStr = (v) => typeof v === 'string' && v.length > 0;

function validate(body) {
  const fields = [];
  if (!isStr(body.chat_room_id)) fields.push('chat_room_id');
  if (!Array.isArray(body.incoming_messages)) fields.push('incoming_messages');
  else body.incoming_messages.forEach((m, i) => {
    if (!m || typeof m !== 'object') { fields.push(`incoming_messages[${i}]`); return; }
    if (!isStr(m.message_id)) fields.push(`incoming_messages[${i}].message_id`);
    if (!isStr(m.sender)) fields.push(`incoming_messages[${i}].sender`);
    if (typeof m.text !== 'string') fields.push(`incoming_messages[${i}].text`);
  });
  if (body.check_dlq !== undefined && typeof body.check_dlq !== 'boolean') fields.push('check_dlq');
  const n = body.simulate_failed_notifications;
  if (n !== undefined && !(Number.isInteger(n) && n >= 0 && n <= 1000)) fields.push('simulate_failed_notifications');
  if (fields.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid moderation request', { fields });
}

// Synchronous end to end, so 10 concurrent identical probes cannot interleave (edge case 3).
function runProbe(body) {
  validate(body);
  const filtered = [];
  const kicked = [];
  const muted = [];
  for (const msg of body.incoming_messages) {
    const r = moderate(msg);
    if (r.action === 'drop') {
      if (!muted.includes(msg.sender)) muted.push(msg.sender);
      continue;
    }
    filtered.push({ message_id: msg.message_id, sender: msg.sender, text: r.text, flagged: r.action === 'flag', reason: r.reason });
    if (r.action === 'flag' && !kicked.includes(msg.sender)) kicked.push(msg.sender);
  }
  if (body.simulate_failed_notifications > 0) dlq.simulateFailures(body.simulate_failed_notifications, body);
  const queueDepth = dlq.depth();
  const flaggedCount = filtered.filter((m) => m.flagged).length;
  return {
    chat_room_id: body.chat_room_id,
    filtered_messages: filtered,
    kicked_users: kicked,
    muted_users: muted,
    dlq_status: { queue_depth: queueDepth, undelivered_events: dlq.snapshot() },
    signature: signDay2(body.chat_room_id, { chat_room_id: body.chat_room_id, flagged_count: flaggedCount, kicked_users: kicked, queue_depth: queueDepth }),
  };
}

module.exports = { runProbe, moderate, mask, isFlood, isProfane };
