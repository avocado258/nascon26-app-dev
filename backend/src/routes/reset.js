const express = require('express');
const pool = require('../db/pool');

const DEFAULT_SPORTS = ['football', 'basketball', 'cricket', 'esports'];

module.exports = function (markSeeded) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const seed = req.body?.seed ?? 42;
    const stock = req.body?.stock ?? { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 };

    // TODO: wipe tables (matches, events, leagues, rosters, orders, offline-sync records, custom sports)
    // TODO: re-insert baseline: tenants, store product+variants, RBAC scenario, demo users, 4 sports

    markSeeded();

    res.status(200).json({
      status: 'reset_complete',
      seed,
      sports: DEFAULT_SPORTS,
      tenants: ['tenant-alpha', 'tenant-beta'],
      stock,
    });
  });

  return router;
};