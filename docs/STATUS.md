# NaSCon '26 — Phase I build status (audited 2026-10-18 02:14)

Sources: [NaSCon_26_App_Dev_Part_1.md](NaSCon_26_App_Dev_Part_1.md) (spec), [Official_Participant_Rules_Booklet.md](Official_Participant_Rules_Booklet.md) (rules).

## Timeline facts

- Phase I locked at 15:00 on Oct 17. The grader used the last commit pushed by 15:05: `3001bc2` (13:57, "Phase 0: skeleton"). The sports/fixtures code was written 14:31–14:44 and **never committed**, so it was not graded.
- **Commit freeze is active now.** No pushes are allowed between 15:05 Oct 17 and 10:15 Oct 18. Day 2 history must continue from `3001bc2`.
- Day 2 sprint: 10:15–14:00, pushes must land by 14:05. Push at least once an hour (−2 per missed hour).

## Cross-check of `day1-handoff.md`

Remote `main` = local `HEAD` = `3001bc2`, so that commit is what was graded. Repo is public (GitHub API 200).

| Handoff claim | Actual |
|---|---|
| sports + fixtures routes "implemented (Day 1)" | Written but **uncommitted**, so not in the graded commit. `3001bc2` has only health, reset stub and schema |
| Reset "seeds 4 default sports" | Only in the uncommitted working tree. Locked `reset.js` seeds nothing |
| `utils/errors.js` | File is `utils/error.js`. The working tree crashes on boot. (The locked commit boots, because it has no utils.) |
| `tests/`, `run_tests.sh`, `COVERAGE.json` at repo root | They sit in `nascon26-app-dev/tests/`, a nested folder. `nascon26-app-dev/mobile/` is an empty dir |
| `.env.example / .env # DAY1_SALT` | The real salt is hard-coded in `docker-compose.yml` and README, also in the locked commit |
| "8 required screens (8.2)" | Spec lists 9: Login, Fixtures, Match detail, Standings, Club profile, Store, Roster mgmt, Scoring entry, Sync status |
| MinIO dropped, local disk | Correct in compose. `.env.example` still lists `MINIO_*` vars |
| node_modules committed once | Not in this clone's history. Probably the WSL clone before a rewrite; harmless now |
| Signature/HMAC not implemented | Correct |
| swiss / double_elim are 400 stubs | Correct |
| Phases 2–6, TRACEABILITY, coverage not started | Correct |
| Mobile app is a placeholder TestApp | Consistent: no mobile code in repo |

Not mentioned in the handoff: the locked `/health` returns 503 until `/reset` runs, but the grader polls `/health` first. Day 1 grading likely failed at startup, which means a −10 penalty and 0 on backend vectors. This must be fixed before the Day 2 audit.

## Done

| Area | What exists | Verified |
|---|---|---|
| Infra | `docker-compose.yml` with backend + postgres + redis + rabbitmq; Dockerfile (node:20-alpine) | Read only, not run |
| Schema | `db/schema.sql`: tables for tenants, sports, leagues, matches, events, clubs, squads, players, roster_audit, products, variants, orders, offline_sync_log | Read only |
| `GET /health` | DB check + seeded flag | Read only |
| `POST /audit/v1/reset` | Resets the sports store and returns the correct response body. No DB wipe/seed (TODO). | Read only |
| `POST /audit/v1/sports` (FR-1.1, part) | Full validation per 5.6, 409 SPORT_EXISTS, default tie_break_order, 4 seeded sports | Read only |
| Fixtures: round robin (FR-1.3) | Circle method, legs, byes, withdrawals, param validation | Unit-tested, 6/6 pass |
| Fixtures: single elim (FR-1.3) | Seed order, byes, propagation, results, third-place | **Ran it: matches spec example (n=6)** |
| Error format | `ApiError` + `sendError` give `{error:{code,message,details}}` | Read only |

## Blockers (fix first)

All 5 fixed locally on 2026-10-18 and not committed yet. Verified on the real Docker stack: compose up took 29 s, `/health` was 200 before any `/reset`, the salt reached the container, and the 400/413 JSON bodies are correct.

1. **Backend crashes on boot.** File is `utils/error.js`; every module requires `../utils/errors`. Rename the file.
2. **`/health` never turns 200 on its own.** The grader polls `/health` *before* it ever calls `/reset` (spec 5.2). Seed baseline data on startup, not only on reset. Otherwise: −10 non-reproducible stack.
3. **Salt is hard-coded.** `docker-compose.yml` sets `DAY1_SALT: T63D...` and README repeats it. Spec requires `DAY1_SALT: ${DAY1_SALT}` and the salt must never be committed.
4. **Repo layout is wrong.** `tests/`, `run_tests.sh` and `COVERAGE.json` must be at repo root (they are in `nascon26-app-dev/tests/`). COVERAGE.json must use `{"fixtures":..,"scoring":..,"standings":..,"store":..,"roster":..,"rbac":..}`.
5. **No JSON errors for bad bodies.** Malformed JSON and >1 MB bodies return Express's HTML errors. Spec needs 400 `VALIDATION_ERROR` and 413 `PAYLOAD_TOO_LARGE` JSON bodies. Add an error middleware.

## Bugs found in existing code

Round robin (`fixtures/roundRobin.js`). **All 4 fixed.** Leg-2 home/away was also fixed so each ordered pair occurs once. Covered by `tests/unit/roundRobin.test.js`, a property test over 2–40 teams × 1/2 legs:
1. `match_id` index skips the bye slot. n=3 gives `RR-L1-R1-M2` for the only match; must be `M1`.
2. Leg-2 `match_id` uses the leg-local round (`RR-L2-R1-…`). Rounds are global, so it must be `RR-L2-R{n}-…`.
3. `after_round` outside `0..round_count` is accepted; must be 400.
4. A match where both teams withdrew becomes `forfeit` awarded to one of them; must be `voided`, `awarded_to: null`.

Sports validation: `tie_break_order` repeats are not rejected (spec: "no repeats").

## Proof of fixes (system tests, 2026-10-18)

Suite: `tests/test_blockers.py` (95 HTTP black-box tests) + `tests/test_health.py` + `tests/unit/roundRobin.test.js` (6 unit tests). Run it with `./run_tests.sh`.

| Check | BEFORE | AFTER |
|---|---|---|
| Stack | Locked commit `3001bc2` via `git archive`, own compose project | Clean copy of only the committable files (no `.env`, no node_modules), fresh volumes, `DAY1_SALT` from shell |
| `/health` without `/reset`, polled 2 s × 60 s | 29 × 503 `not_ready`. The grader's startup check fails | 200 after 2 s |
| `compose up --build` | — | 11 s (limit 600 s) |
| Salt | Hard-coded in compose | Container gets the shell value; real salt is in 0 committable files |
| Malformed JSON | HTML page with stack trace | 400 `VALIDATION_ERROR` JSON |
| Body > 1 MB | HTML 413 | 413 `PAYLOAD_TOO_LARGE` JSON on 3 routes; a body just under 1 MB still gets 200 |
| `/reset` twice | — | Identical responses |
| HTTP suite | 99 failed / 2 passed | 101 passed |
| Round-robin unit tests | Original code: 3/6 fail (leg-2 id `RR-L2-R1-M1`, both-withdrawn `forfeit`, `after_round` 99 accepted). n=3 id `M2`; n=4 legs=2 duplicate pair `t3>t1` | 6/6 pass; n=3 id `M1`; no duplicate pairs |
| Backend restart | — | `/health` 200 again (re-seeds on boot) |
| DB unreachable at boot | Not tested (an unhandled rejection likely crashed it anyway) | Logs `Startup failed`, exits 1 so Docker restarts it |

## Remaining work (Phase I spec, ranked by points)

Backend = 36 pts across 6 areas, each scored on ≥40 hidden vectors.

1. **Fixtures (FR-1.3)**: fix RR bugs; build Swiss (exact round 1, backtracking min-cost pairing, Buchholz, 409 NO_VALID_PAIRING); build double elim (WR/LR/GF ids, routing, bracket reset). Not started: rescheduling conflict detection, match state machine broadcast.
2. **Scoring engine (FR-1.1)**: `POST /audit/v1/events`, `GET /audit/v1/score/{id}`. Append-only log, HMAC signatures (5.3, test vector 1), compensation, idempotency, INNINGS_COMPLETE / SERIES_ALREADY_DECIDED, outcome/winner logic. Not started.
3. **Standings (FR-1.4)**: `POST /audit/v1/leagues`, `GET /audit/v1/standings/{id}`. Recursive tie-break resolve, h2h matrix, NRR for innings, draw_lots SHA256 (test vector 2), clinched/eliminated. Not started.
4. **Store (FR-2.3, NFR-3)**: `POST /audit/v1/checkout`, `GET /audit/v1/inventory/{id}`. Atomic reservation (Postgres row lock or Redis), mock gateway tokens, WELCOME10, signed receipt, server-side PDF with `PKR 4500.00`, RabbitMQ domain event. Not started.
5. **Roster (FR-2.2)**: `roster/setup`, `roster/transfer` (8 checks in exact order), `roster/history` with `as_of` loan auto-return. Not started.
6. **RBAC + security (FR-5.1, NFR-5)**: `POST /audit/v1/rbac-matrix` (5 JWTs), 7 probe routes with the exact A/D matrix, 401 for none/tampered/expired, `GET /api/v1/ping` rate limit (100 per 10 s, 429 + Retry-After). Not started.
7. **Offline sync (NFR-4, 4 pts)**: `POST /audit/v1/offline-sync` with applied/rebased_append/duplicate/server_wins rules. Not started.
8. **Reset/seed (5.5)**: wipe every table; seed tenants, product/variants, WELCOME10, RBAC leagues/clubs/players, 5 demo users. Not started.
9. **Mobile app (14 pts: 10 UI/HCI + 4 offline)**: `mobile/` is empty. Needs 9 screens, secure token storage, local DB cache, persistent action queue, `mobile/release/app-release.apk`. Not started.
10. **Docs**: TRACEABILITY.md rows are all TODO with planned paths (`backend/leagues/` etc.) that don't match `backend/src/...`. ADR.md (8 ADRs, needed for the Top-8 viva) does not exist.
11. **Tests**: only `test_health.py`. Need unit tests per area for the ≥85% coverage bonus (10% of each area).

## Rules compliance

| Rule | Status |
|---|---|
| Public repo, registered | Remote `avocado258/nascon26-app-dev` exists; visibility not checked |
| Hourly pushes Day 1 (4 windows) | Commits at 12:44, 12:54, 13:57 only. 10:45–11:45 and 11:45–12:45 windows appear missed (−4), if push times match commit times |
| No BaaS | OK |
| No hard-coded sport logic (−8) | OK so far. Sport names appear only in seed data |
| Salt from env only | **Violated** (compose + README) |
| Overnight freeze | Active until 10:15 today |
