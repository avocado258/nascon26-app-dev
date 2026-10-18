// In-process event bus. Emitters: scoring engine ('match', match_id). Consumers: WS/SSE fan-out (Tier 1).
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(0);

module.exports = bus;
