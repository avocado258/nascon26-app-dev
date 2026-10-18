const express = require('express');
const engine = require('../scoring/engine');
const { guardWrite } = require('../auth/guest');
const { sendError } = require('../utils/errors');

const events = express.Router();
events.post('/', guardWrite, (req, res) => {
  try {
    const { status, body } = engine.append(req.body || {});
    res.status(status).json(body);
  } catch (err) {
    sendError(res, err);
  }
});

const score = express.Router();
score.get('/:match_id', (req, res) => {
  try {
    res.status(200).json(engine.score(req.params.match_id));
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = { events, score };
