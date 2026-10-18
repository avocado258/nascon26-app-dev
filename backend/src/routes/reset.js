const express = require('express');
const { seedBaseline } = require('../seed');
const { DEFAULT_STOCK } = require('../state/registry');
const { ApiError, sendError } = require('../utils/errors');

const DEFAULT_SPORTS = ['football', 'basketball', 'cricket', 'esports'];

module.exports = function (markSeeded) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const body = req.body || {};
      const seed = body.seed ?? 42;
      const stock = body.stock ?? DEFAULT_STOCK;
      const fields = [];
      if (!Number.isInteger(seed)) fields.push('seed');
      if (stock === null || typeof stock !== 'object' || Array.isArray(stock)
        || !Object.values(stock).every((v) => Number.isInteger(v) && v >= 0)) fields.push('stock');
      if (fields.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid reset body', { fields });

      await seedBaseline({ seed, stock });

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
