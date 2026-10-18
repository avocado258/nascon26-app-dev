// Guest Web Player (D2 FR-4.2, 6.2.2): one HTML shell for every /web/* route; app.js renders by path.
const express = require('express');
const fs = require('fs');
const path = require('path');
const hub = require('../realtime/hub');

const WEB_DIR = path.join(__dirname, '..', 'web');
const SHELL = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8');
const router = express.Router();

router.use('/static', express.static(WEB_DIR, { index: false, maxAge: '5m' }));
router.get('/vendor/hls.min.js', (req, res) => res.sendFile(require.resolve('hls.js/dist/hls.min.js')));

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The current score is rendered server-side so the banner is correct on first paint; WS/SSE keep it live.
function shell(req, res) {
  let html = SHELL;
  const matchId = req.params.view !== undefined ? req.params.id : (req.path.startsWith('/costream/') ? (req.query.match || 'match-m1') : null);
  const score = matchId && hub.scorePayload(String(matchId));
  if (score) {
    html = html
      .replace('id="live-score-banner" class="score" role="status" aria-live="polite" aria-label="Live score">– - –', `id="live-score-banner" class="score" role="status" aria-live="polite" aria-label="Live score">${escape(score.banner)}`)
      .replace('aria-label="Home club">HOME', `aria-label="Home club">${escape(score.home.team_id)}`)
      .replace('aria-label="Away club">AWAY', `aria-label="Away club">${escape(score.away.team_id)}`);
  }
  res.type('html').send(html);
}
router.get(['/matches/:id/:view', '/players/:id', '/clubs/:id', '/costream/:id'], shell);

module.exports = router;
