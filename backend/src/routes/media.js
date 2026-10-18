const express = require('express');
const keys = require('../streaming/keys');

// MediaMTX authHTTPAddress hook: only active stream keys may publish or play on live/{key}.
const router = express.Router();
router.post('/auth', (req, res) => {
  const { status, body } = keys.authorizeMedia(req.body || {});
  res.status(status).json(body);
});

module.exports = router;
