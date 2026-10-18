// Dependency probes for /health (D2 5.1: DB, Redis, media server). Each resolves to true/false within ~1 s.
const net = require('net');

function redisPing(url = process.env.REDIS_URL, timeoutMs = 1000) {
  if (!url) return Promise.resolve(true);
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const sock = net.connect({ host: hostname, port: Number(port) || 6379 });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.on('error', () => done(false));
    sock.on('connect', () => sock.write('PING\r\n'));
    sock.on('data', (d) => done(d.toString().startsWith('+PONG')));
  });
}

async function mediaReady(api = process.env.MEDIAMTX_API, timeoutMs = 1000) {
  if (!api) return true;
  try {
    const r = await fetch(`${api}/v3/config/global/get`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

module.exports = { redisPing, mediaReady };
