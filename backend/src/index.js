require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('./db/pool');
const resetRouter = require('./routes/reset');
const sportsRoutes = require('./routes/sports');
const fixturesRoutes = require('./routes/fixtures');
const { seedBaseline } = require('./seed');
const { errorBody, sendError } = require('./utils/errors');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/audit/v1/sports', sportsRoutes);
app.use('/audit/v1/fixtures', fixturesRoutes);


let dbReady = false;
let seeded = false;

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    dbReady = true;
    if (dbReady && seeded) {
      return res.status(200).json({ status: 'ok' });
    }
    return res.status(503).json({ status: 'not_ready' });
  } catch (err) {
    return res.status(503).json({ status: 'db_unreachable' });
  }
});

app.use('/audit/v1/reset', resetRouter(() => { seeded = true; }));

// Body-parser failures must use the uniform error body (spec 5.2), not Express's HTML page.
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB'));
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json(errorBody('VALIDATION_ERROR', 'Malformed JSON body', { fields: ['body'] }));
  }
  sendError(res, err);
});

const PORT = process.env.PORT || 8080;

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
  await pool.query(sql);
}

migrate()
  .then(seedBaseline)
  .then(() => {
    seeded = true;
    app.listen(PORT, () => console.log(`Listening on ${PORT}`));
  })
  .catch((err) => {
    // Exit so the container's restart policy retries instead of hanging without a listener.
    console.error('Startup failed:', err);
    process.exit(1);
  });
