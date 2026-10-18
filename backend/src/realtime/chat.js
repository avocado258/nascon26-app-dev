// Chat rooms with one monotonically increasing sequence per room, shared by every host and viewer (FR-3.3).
const bus = require('./bus');
const { registerReset } = require('../seed');

const rooms = new Map(); // room_id -> { seq, messages: [] }

registerReset(() => rooms.clear());

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { seq: 0, messages: [] });
  return rooms.get(roomId);
}

function publish(roomId, message) {
  const room = ensureRoom(roomId);
  const entry = { ...message, chat_room_id: roomId, seq: ++room.seq, sent_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
  room.messages.push(entry);
  if (room.messages.length > 200) room.messages.shift();
  bus.emit('chat', roomId, entry);
  return entry;
}

const history = (roomId) => (rooms.get(roomId)?.messages || []).slice();

module.exports = { ensureRoom, publish, history };
