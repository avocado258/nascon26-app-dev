const express = require('express');
const { generateRoundRobin } = require('../fixtures/roundRobin');
const { generateSingleElim } = require('../fixtures/singleElim');
const { ApiError, sendError } = require('../utils/errors');

const router = express.Router();

router.post('/', (req, res) => {
  try {
    const { format, teams, params } = req.body || {};
    if (!Array.isArray(teams) || new Set(teams).size !== teams.length) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'teams must be unique array', { fields: ['teams'] });
    }
    let result;
    switch (format) {
      case 'round_robin': result = generateRoundRobin(teams, params); break;
      case 'single_elim': result = generateSingleElim(teams, params); break;
      case 'swiss': throw new ApiError(400, 'VALIDATION_ERROR', 'swiss not yet implemented', { fields: ['format'] });
      case 'double_elim': throw new ApiError(400, 'VALIDATION_ERROR', 'double_elim not yet implemented', { fields: ['format'] });
      default: throw new ApiError(400, 'VALIDATION_ERROR', 'unknown format', { fields: ['format'] });
    }
    res.status(200).json(result);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;