require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('./db/pool');
const resetRouter = require('./routes/reset');

const app = express();
app.use(express.json({ limit: '1mb' }));

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

const PORT = process.env.PORT || 8080;

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
  await pool.query(sql);
}

migrate().then(() => {
  app.listen(PORT, () => console.log(`Listening on ${PORT}`));
});