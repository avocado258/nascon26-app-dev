const express = require('express');

// MediaMTX authHTTPAddress hook. Tier 1 (P1.1) replaces this with stream-key validation.
const router = express.Router();
router.post('/auth', (req, res) => res.status(200).json({ ok: true }));

module.exports = router;
