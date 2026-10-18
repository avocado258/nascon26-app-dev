// WebSocket + SSE fan-out for live scores and chat (NFR-1: push on append, no polling).
const { WebSocketServer } = require('ws');
const bus = require('./bus');
const chat = require('./chat');
const engine = require('../scoring/engine');

const subscribers = { match: new Map(), chat: new Map() }; // kind -> id -> Set<send(fn)>
const stats = { ws: 0, sse: 0 };

function scorePayload(matchId) {
  try {
    const s = engine.score(matchId);
    return {
      type: 'score', match_id: matchId, status: s.status, outcome: s.outcome, version: s.version,
      home: { team_id: s.home.team_id, score: s.home.score }, away: { team_id: s.away.team_id, score: s.away.score },
      banner: `${s.home.score} - ${s.away.score}`,
    };
  } catch {
    return null;
  }
}

function subscribe(kind, id, send) {
  const map = subscribers[kind];
  if (!map.has(id)) map.set(id, new Set());
  map.get(id).add(send);
  if (kind === 'match') {
    const p = scorePayload(id);
    if (p) send(p);
  } else {
    for (const m of chat.history(id)) send({ type: 'chat', ...m });
  }
  return () => map.get(id)?.delete(send);
}

function fanout(kind, id, payload) {
  const set = subscribers[kind].get(id);
  if (!set) return;
  for (const send of set) send(payload);
}

bus.on('match', (matchId) => {
  const p = scorePayload(matchId);
  if (p) fanout('match', matchId, p);
});
bus.on('chat', (roomId, msg) => fanout('chat', roomId, { type: 'chat', ...msg }));

const ROUTES = [[/^\/ws\/matches\/([^/?]+)/, 'match'], [/^\/ws\/chat\/([^/?]+)/, 'chat']];

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const hit = ROUTES.map(([re, kind]) => [re.exec(req.url), kind]).find(([m]) => m);
    if (!hit) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      stats.ws += 1;
      const unsubscribe = subscribe(hit[1], decodeURIComponent(hit[0][1]), (p) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(p));
      });
      ws.on('close', () => { stats.ws -= 1; unsubscribe(); });
      ws.on('error', () => ws.close());
    });
  });
}

function sse(kind) {
  return (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    stats.sse += 1;
    const unsubscribe = subscribe(kind, req.params.id, (p) => res.write(`data: ${JSON.stringify(p)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); stats.sse -= 1; unsubscribe(); });
  };
}

module.exports = { attach, sse, stats, scorePayload };
