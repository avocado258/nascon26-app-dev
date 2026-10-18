const express = require('express');
const qr = require('../qr/engine');
const { ApiError, sendError } = require('../utils/errors');

const audit = express.Router();
audit.get('/:entity_id', (req, res) => {
  try {
    res.status(200).json(qr.resolve(req.params.entity_id, { inspect: req.query.inspect === 'true', userAgent: req.headers['user-agent'] }));
  } catch (err) {
    sendError(res, err);
  }
});
audit.get('/:entity_id/:file', async (req, res) => {
  try {
    const m = /^export\.(svg|png|pdf)$/.exec(req.params.file);
    if (!m) throw new ApiError(404, 'QR_NOT_FOUND', 'Unknown export format', { file: req.params.file });
    const out = await qr.exportQr(req.params.entity_id, m[1]);
    res.status(200).type(out.type).send(out.body);
  } catch (err) {
    sendError(res, err);
  }
});

// Public short link: 302 to the route for the entity's state at scan time.
const short = express.Router();
short.get('/:short_code', (req, res) => {
  try {
    const r = qr.resolveShortCode(req.params.short_code, req.headers['user-agent']);
    res.redirect(302, r.target_route);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = { audit, short };
