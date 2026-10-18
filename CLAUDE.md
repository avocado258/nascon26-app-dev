# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NaSCon '26 competition entry: a multi-sport league & club operations platform. The backend is graded by an external judge harness that calls HTTP endpoints under `/audit/v1/*`, so **response shapes, status codes and error bodies are part of the spec**. Don't rename fields or change codes casually.

`TRACEABILITY.md` maps every FR/NFR requirement ID to source files and tests. Judges grade from it, so update its row (paths + status) whenever a requirement is implemented. Its planned paths (`backend/leagues/`, `backend/rbac/`, …) show where future modules are meant to go.

## Commands

```bash
# Full stack (backend + postgres + redis + rabbitmq), from repo root
docker compose up -d --build
curl http://localhost:8080/health      # 200 only after POST /audit/v1/reset has run once

# Seed / reset state (the judge calls this before scenarios)
curl -X POST localhost:8080/audit/v1/reset -H 'Content-Type: application/json' -d '{"seed":42}'

# Backend locally (needs DATABASE_URL pointing at a reachable Postgres; dotenv loads .env)
cd backend && npm install && node src/index.js

# Tests, from repo root: Node unit tests (tests/unit/*.test.js, no server needed),
# then pytest black-box tests against a running server on :8080
./run_tests.sh
node --test tests/unit/roundRobin.test.js     # one unit file
pytest tests/test_health.py::test_health      # one API test
```

There's no lint setup, and `npm test` is a placeholder. `nodemon` is a devDependency, but no script uses it yet.

## Architecture

- **Stack:** Node 20, Express 5, CommonJS, `pg`. Entry point is `backend/src/index.js`. On boot it runs `db/schema.sql` (all `CREATE TABLE IF NOT EXISTS`, idempotent) and then listens on 8080.
- **Readiness:** `/health` returns 200 once the DB answers and the baseline is seeded. Boot runs migrate, then `seedBaseline()`, then listens, because the grader polls `/health` *before* its first `/reset`. If startup fails the process exits so the container restarts.
- **Baseline lives in `seed.js`.** `seedBaseline()` runs on boot and on every `POST /audit/v1/reset`. Today it only resets the in-memory sports store. Wiping and re-seeding DB tables is TODO: tenants `tenant-alpha`/`tenant-beta`, store variants/stock, RBAC demo users, the 4 default sports. Any new stateful module must hook its reset into `seedBaseline()`.
- **Sports (`sports/`):** an in-memory `Map` (`store.js`) seeded on reset with football/basketball/cricket/esports. Each sport has a `scoring_model` of `event` | `innings` | `round`, and the shapes of `periods` and `scoring_events` depend on that model (see `validate.js`). Validation collects *all* bad field paths before throwing. The `sports` DB table exists but isn't used yet.
- **Fixtures (`fixtures/`):** pure functions that take a team list and params and return a schedule, with no persistence. `round_robin` uses the circle method and supports legs and withdrawals (`forfeit_remaining` / `void_all`). `single_elim` pads to a power of 2 with seeded byes, links matches with `winner_to`/`loser_to`, supports an optional third-place match, and replays `params.results`. `swiss` and `double_elim` are still stubs.
- **Errors:** routes throw `ApiError(status, code, message, details)` (from `utils/errors.js`) and catch with `sendError(res, err)`. The uniform body is `{ error: { code, message, details } }`, and validation failures use `VALIDATION_ERROR` with `details.fields`. A final error middleware in `index.js` maps malformed JSON to 400 `VALIDATION_ERROR` and bodies over 1 MB to 413 `PAYLOAD_TOO_LARGE`.
- **Infra wired but unused:** Redis, RabbitMQ and local file storage (`STORAGE_PATH`) are provisioned in `docker-compose.yml`. The planned uses are store checkout concurrency (NFR-3) and offline sync idempotency via `offline_sync_log` (NFR-4). The `events` table is designed for signed, sequenced, compensatable match events (event sourcing).

## Gotchas

- `DAY1_SALT` comes from the environment (`${DAY1_SALT}` in compose; Compose also reads the root `.env`). Never commit the real salt. It is still in git history at `3001bc2`, which can't be rewritten because Day 2 must continue from that SHA. DB credentials are hardcoded in compose.
- README mentions a `mobile/` app, but none exists yet.
- `COVERAGE.json` (repo root, spec 9.3 format) is hand-maintained. The grader voids an area's bonus if the declared figure is more than 2 points above the real one, so never inflate it. All areas are 0.0 until real coverage is measured.
