// 4-way co-stream sessions with deterministic host-drop handoff (D2 5.5).
const { registerReset } = require('../seed');
const registry = require('../state/registry');
const chat = require('../realtime/chat');
const { ApiError } = require('../utils/errors');
const { canonical, signDay2 } = require('../utils/sign');

const LAYOUTS = ['solo', 'grid_2', 'grid_4', 'spotlight'];
const LAYOUT_LIMIT = { solo: 1, grid_2: 2 };
const sessions = new Map(); // session_id -> { request_key, response }

registerReset(() => sessions.clear());

const isStr = (v) => typeof v === 'string' && v.length > 0;

function validate(body) {
  const fields = [];
  if (!isStr(body.session_id)) fields.push('session_id');
  if (!isStr(body.host_player_id)) fields.push('host_player_id');
  const p = body.participants;
  if (!Array.isArray(p) || p.length === 0 || !p.every(isStr) || new Set(p).size !== p.length) fields.push('participants');
  if (body.layout !== undefined && !LAYOUTS.includes(body.layout)) fields.push('layout');
  if (body.simulate_host_drop !== undefined && typeof body.simulate_host_drop !== 'boolean') fields.push('simulate_host_drop');
  if (fields.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid co-stream request', { fields });
}

function start(body) {
  validate(body);
  const layout = body.layout ?? 'grid_4';
  const drop = body.simulate_host_drop ?? false;
  const { session_id, host_player_id, participants } = body;
  const requestKey = canonical({ session_id, host_player_id, participants, layout, simulate_host_drop: drop });

  // Capacity is checked before existence: only 4 players are seeded, so any 5-participant request
  // contains an unknown id and COSTREAM_SESSION_FULL would otherwise be unreachable.
  if (participants.length > 4) {
    throw new ApiError(409, 'COSTREAM_SESSION_FULL', 'Co-streams support at most 4 broadcasters', { session_id, max_participants: 4 });
  }
  for (const id of [...participants, host_player_id]) {
    if (!registry.state.players.has(id)) throw new ApiError(404, 'PLAYER_NOT_FOUND', `Player ${id} not found`, { player_id: id });
  }
  if (!participants.includes(host_player_id)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'host_player_id must be one of participants', { fields: ['host_player_id'] });
  }

  let active = [...participants];
  let activeHost = host_player_id;
  let handoff = false;
  let status = 'active';
  if (drop) {
    active = participants.filter((p) => p !== host_player_id);
    if (active.length > 0) {
      activeHost = active[0];
      handoff = true;
    } else {
      activeHost = null;
      status = 'terminated';
    }
  }
  if (LAYOUT_LIMIT[layout] !== undefined && active.length > LAYOUT_LIMIT[layout]) {
    throw new ApiError(400, 'UNSUPPORTED_LAYOUT', `Layout ${layout} cannot fit ${active.length} active participants`, { layout, participant_count: active.length });
  }

  const prior = sessions.get(session_id);
  if (prior && prior.request_key === requestKey) return { status: 200, body: prior.response };

  const response = {
    session_id,
    status,
    active_host: activeHost,
    handoff_occurred: handoff,
    participant_count: active.length,
    active_participants: active,
    layout,
    composite_playback_url: `http://localhost:8888/costream/${session_id}/index.m3u8`,
    chat_room_id: `chat-${session_id}`,
    signature: signDay2(session_id, { active_host: activeHost, handoff_occurred: handoff, layout, participant_count: active.length, session_id, status }),
  };
  sessions.set(session_id, { request_key: requestKey, response });
  chat.ensureRoom(response.chat_room_id);
  return { status: prior ? 200 : 201, body: response };
}

const get = (sessionId) => sessions.get(sessionId)?.response;

// Live host disconnect (edge case 1): the same deterministic handoff as simulate_host_drop, applied
// when a participant's presence socket closes. Chat room and composite URL are kept.
function dropParticipant(sessionId, playerId) {
  const entry = sessions.get(sessionId);
  if (!entry || entry.response.status !== 'active' || !entry.response.active_participants.includes(playerId)) return null;
  const prev = entry.response;
  const active = prev.active_participants.filter((p) => p !== playerId);
  const wasHost = prev.active_host === playerId;
  const activeHost = wasHost ? (active[0] ?? null) : prev.active_host;
  const handoff = wasHost ? active.length > 0 : prev.handoff_occurred;
  const status = active.length > 0 ? 'active' : 'terminated';
  const next = {
    ...prev, status, active_host: activeHost, handoff_occurred: handoff, participant_count: active.length, active_participants: active,
    signature: signDay2(sessionId, { active_host: activeHost, handoff_occurred: handoff, layout: prev.layout, participant_count: active.length, session_id: sessionId, status }),
  };
  entry.response = next;
  return next;
}

module.exports = { start, get, dropParticipant };
