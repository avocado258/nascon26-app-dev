const express = require('express');
const store = require('../sports/store');
const { validateSportPayload } = require('../sports/validate');
const { ApiError, sendError } = require('../utils/errors');

const router = express.Router();

router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    validateSportPayload(body);
    if (store.exists(body.sport_id)) {
      throw new ApiError(409, 'SPORT_EXISTS', `Sport ${body.sport_id} already exists`, { sport_id: body.sport_id });
    }
    const config = { ...body };
    if (config.tie_break_order === undefined) {
      config.tie_break_order = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];
    }
    store.create(body.sport_id, config);
    res.status(201).json({ sport_id: body.sport_id, status: 'created', config });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;