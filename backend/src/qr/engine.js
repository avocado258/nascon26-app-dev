// Dynamic QR deep-links (D2 5.6): stable short_url, target_route derived from live entity state on every scan.
const crypto = require('crypto');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { registerReset } = require('../seed');
const registry = require('../state/registry');
const engine = require('../scoring/engine');
const costream = require('../costream/engine');
const { ApiError } = require('../utils/errors');
const { signDay2 } = require('../utils/sign');

const SEEDED = [['match-m1', 'm1-live'], ['player-alpha-1', 'p-alpha-1'], ['club-alpha-1', 'c-alpha-1']];

const byEntity = new Map(); // entity_id -> { entity_id, short_code, scan_count }
const byCode = new Map();   // short_code -> entity_id
const telemetry = [];       // { entity_id, device_family, bucket } — no IP, no UA, no cookies (NFR-9)
const counters = { scansTotal: 0 };

function addMapping(entityId, shortCode) {
  byEntity.set(entityId, { entity_id: entityId, short_code: shortCode, scan_count: 0 });
  byCode.set(shortCode, entityId);
}

registerReset(() => {
  byEntity.clear();
  byCode.clear();
  telemetry.length = 0;
  counters.scansTotal = 0;
  for (const [id, code] of SEEDED) addMapping(id, code);
});

const baseUrl = () => process.env.PUBLIC_BASE_URL || 'http://localhost:8080';
const notFound = (id) => new ApiError(404, 'QR_NOT_FOUND', `No dynamic QR mapping for ${id}`, { entity_id: id });

function describe(entityId) {
  if (engine.getMatch(entityId)) {
    const status = engine.score(entityId).status;
    const routes = { upcoming: 'preview', in_progress: 'live', completed: 'vod' };
    const route = routes[status] ? `/web/matches/${entityId}/${routes[status]}` : `/web/matches/${entityId}/notice?state=${status}`;
    return { type: 'match', status, route };
  }
  if (registry.state.players.has(entityId)) return { type: 'player', status: 'active', route: `/web/players/${entityId}` };
  if (registry.state.clubs.has(entityId)) return { type: 'club', status: 'active', route: `/web/clubs/${entityId}` };
  const session = costream.get(entityId);
  if (session) return { type: 'costream', status: session.status, route: `/web/costream/${entityId}` };
  return null;
}

// Mapping for entities without a seeded code is created lazily and never changes afterwards.
function mappingFor(entityId) {
  let m = byEntity.get(entityId);
  if (!m) {
    if (!describe(entityId)) throw notFound(entityId);
    addMapping(entityId, `q-${crypto.createHash('sha256').update(entityId).digest('hex').slice(0, 10)}`);
    m = byEntity.get(entityId);
  }
  return m;
}

function recordScan(m, userAgent) {
  m.scan_count += 1;
  counters.scansTotal += 1;
  const bucket = new Date().toISOString().slice(0, 13) + ':00:00Z';
  telemetry.push({ entity_id: m.entity_id, device_family: /Mobi|Android|iPhone|iPad/i.test(userAgent || '') ? 'mobile' : 'desktop', bucket });
}

function resolve(entityId, { inspect = false, userAgent } = {}) {
  const m = mappingFor(entityId);
  const d = describe(entityId);
  if (!d) throw notFound(entityId);
  if (!inspect) recordScan(m, userAgent);
  const shortUrl = `${baseUrl()}/q/${m.short_code}`;
  const exportBase = `${baseUrl()}/audit/v1/qr/${entityId}/export`;
  return {
    entity_id: entityId,
    entity_type: d.type,
    entity_status: d.status,
    short_url: shortUrl,
    target_route: d.route,
    deep_link_uri: `nascon://entity/${entityId}`,
    scan_count: m.scan_count,
    export_formats: { svg: `${exportBase}.svg`, png: `${exportBase}.png`, pdf: `${exportBase}.pdf` },
    signature: signDay2(entityId, { entity_id: entityId, short_url: shortUrl, target_route: d.route }),
  };
}

function resolveShortCode(code, userAgent) {
  const entityId = byCode.get(code);
  if (!entityId) throw new ApiError(404, 'QR_NOT_FOUND', `Unknown short code ${code}`, { short_code: code });
  return resolve(entityId, { userAgent });
}

async function exportQr(entityId, fmt) {
  const m = mappingFor(entityId);
  const shortUrl = `${baseUrl()}/q/${m.short_code}`;
  if (fmt === 'svg') return { type: 'image/svg+xml', body: await QRCode.toString(shortUrl, { type: 'svg', margin: 2 }) };
  if (fmt === 'png') return { type: 'image/png', body: await QRCode.toBuffer(shortUrl, { type: 'png', width: 512, margin: 2 }) };
  const png = await QRCode.toBuffer(shortUrl, { type: 'png', width: 600, margin: 2 });
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `QR ${entityId}` } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', r));
  doc.fontSize(28).text('NaSCon ’26 Live', { align: 'center' });
  doc.moveDown().fontSize(18).text(entityId, { align: 'center' });
  doc.image(png, (doc.page.width - 360) / 2, 180, { width: 360 });
  doc.fontSize(14).text(shortUrl, 50, 560, { align: 'center' });
  doc.end();
  await done;
  return { type: 'application/pdf', body: Buffer.concat(chunks) };
}

module.exports = { resolve, resolveShortCode, exportQr, counters, telemetry };
