const express = require('express');
const { seedBaseline } = require('../seed');
const { sendError } = require('../utils/errors');

const DEFAULT_SPORTS = ['football', 'basketball', 'cricket', 'esports'];

module.exports = function (markSeeded) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const seed = req.body?.seed ?? 42;
      const stock = req.body?.stock ?? { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 };
      await seedBaseline();

      markSeeded();

      res.status(200).json({
        status: 'reset_complete',
        seed,
        sports: DEFAULT_SPORTS,
        tenants: ['tenant-alpha', 'tenant-beta'],
        stock,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
};
