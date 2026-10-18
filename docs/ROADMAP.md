# ROADMAP — minimal path to spec completion

Spec: `docs/NaSCon_26_App_Dev_Part_1.md` (cited as `S:<lines>`). Rules: `docs/Official_Participant_Rules_Booklet.md`. Current state: `docs/STATUS.md`.

## 0. Hard constraints

| ID | Constraint |
|---|---|
| C1 | Request/response shapes, status codes and error codes in `S:222-1168` are compared literally. Never rename fields. |
| C2 | Error body: `{"error":{"code","message","details"}}`; `details` always an object; `VALIDATION_ERROR` → `details.fields: string[]`. Use `ApiError` + `sendError` (`backend/src/utils/errors.js`). |
| C3 | Validation order: 400 schema → 404 missing id → 409 business rule (402 payment). First failure wins (`S:293-295`). |
| C4 | Idempotency: same client id + identical body → 200 + stored response, no state change; same id + different body → 409 `DUPLICATE_*` (`S:296-297`). |
| C5 | No branch on any sport id or event name in domain logic (−8, `S:1350-1353`). Seed data may name sports. |
| C6 | `DAY1_SALT` read from env only. Never commit its value. |
| C7 | All mutable state is reset by `seedBaseline()` in `backend/src/seed.js` (boot + every `/audit/v1/reset`). Every new store registers its reset there. |
| C8 | `/audit/v1/*` and `/health`: no rate limit. Every request < 5 s; reset < 10 s; 20-request checkout burst < 10 s. |
| C9 | IDs: 1–64 chars `[A-Za-z0-9_.:-]`, case-sensitive, stored and echoed verbatim. Timestamps `YYYY-MM-DDTHH:MM:SSZ`; dates `YYYY-MM-DD`; money integer minor units, currency `"PKR"`. |
| C10 | Git: no pushes between 15:05 Oct 17 and 10:15 Oct 18 PKT. Day 2 history continues from `3001bc2`. ≥1 push per hour during sprints. Day 2 deadline 14:05 PKT. Never commit PDFs in repo root or `.env`. |
| C11 | Day 2 spec releases 10:15 Oct 18. On release: read it fully, then re-rank §2 by Day 2 points before continuing. |

## 1. Architecture decisions (fixed)

- State for all `/audit/v1/*` domains: in-memory `Map` stores per module, reset via C7. Node's single thread makes a synchronous check-and-decrement atomic, which satisfies NFR-3 without DB locks. Postgres stays for schema/migrate only unless Day 2 requires persistence.
- Module layout: `backend/src/<area>/` (pure logic + store) and `backend/src/routes/<area>.js` (HTTP + validation). Mount routes in `backend/src/index.js` **before** the final error middleware.
- Unit tests: `tests/unit/<area>.test.js` (`node:test`, no server). API tests: `tests/test_<area>.py` (pytest + requests on `:8080`). `run_tests.sh` runs both.
- Allowed new deps: `jsonwebtoken`, `pdfkit`, `amqplib` (optional), `c8` (dev). No fixture-generation libraries.

## 2. Work packages (execute in order; dependencies listed)

### WP1 — Shared utilities
Deps: none.
Files: `backend/src/utils/sign.js`, `backend/src/utils/lots.js`, `backend/src/utils/validate.js`.
- `canonical(obj)`: recursively sorted keys (code-point order), separators `,` `:`, no whitespace, UTF-8, non-ASCII unescaped, arrays in order. `JSON.stringify` with a recursive key-sorting replacer satisfies this for integer payloads. `S:347-350`.
- `sign(id, payloadObj)`: `HMAC-SHA256(key=utf8(DAY1_SALT), msg=utf8(id + "|" + canonical(payload)))` → lowercase hex (64 chars). `S:340-352`.
- `lotsKey(seed, leagueId, teamId)`: `sha256_hex(`${seed}|${leagueId}|${teamId}`)`. `S:1379-1380`.
- `validate.js`: `isId`, `isDate`, `isInt(min,max)`, helper that collects field names, then throws one `VALIDATION_ERROR`.
Done when: unit tests reproduce `S:1382-1389` exactly — vector 1 `972a8b55…d7ec501` with salt `demo-salt`; vector 2 keys for t1/t2/t3.

### WP2 — Baseline seed (`S:359-410`, `S:1240-1249`)
Deps: WP1.
Files: `backend/src/seed.js`, `backend/src/routes/reset.js`, new stores (`tenants`, `store`, `rbac`, `users`).
- Reset body: `seed` int (default 42), `stock` map variant→int ≥0 (defaults M=1, L=5). Validate → 400. Store `seed` as `lastResetSeed` (default lots seed for WP4).
- Seed exactly: tenants `tenant-alpha` ("Alpha Sports"), `tenant-beta` ("Beta Athletics"); product `prod-jersey-001` (tenant-alpha); variants `var-jersey-001-M`, `var-jersey-001-L`, `price_minor` 450000, PKR, stock from body; discount `WELCOME10` = 10%; leagues `league-alpha-1`, `league-alpha-2` (alpha), `league-beta-1` (beta); clubs `club-alpha-1`, `club-alpha-2`, `club-beta-1`; players `player-alpha-1`→club-alpha-1, `player-alpha-2`→club-alpha-2, `player-beta-1`→club-beta-1; 4 sports (existing `sports/store.js`).
- Users (password `Nascon@26`, store a hash): `admin@nascon.test` super_admin; `organizer@nascon.test` league_organizer owns league-alpha-1; `manager@nascon.test` club_manager owns club-alpha-1; `player@nascon.test` player = player-alpha-1; `viewer@nascon.test` viewer, tenant-alpha.
- Reset wipes: matches, events, leagues, rosters, audit, orders, idempotency maps, offline-sync log, custom sports.
Done when: two consecutive resets return identical bodies and identical store snapshots; response matches `S:371-379`.

### WP3 — Event-sourced scoring (`S:669-774`) — FR-1.1
Deps: WP1, WP2.
Files: `backend/src/scoring/{store,project,events}.js`, `backend/src/routes/events.js` (`POST /audit/v1/events`, `GET /audit/v1/score/:match_id`).
- Match stream: `{match_id, sport_id, league_id|null, home_team_id, away_team_id, log: []}`. Created by `match_init` or league registration (WP4). Log is append-only; never mutate entries.
- Request: `{event_id, match_id, type, payload}`. Types and rules (status is derived from the log):
  - `match_init` `{sport_id, home_team_id, away_team_id, league_id?}`: existing stream → 409 `MATCH_EXISTS`; unknown sport → 404 `SPORT_NOT_FOUND`.
  - Any other type on a missing stream → 404 `MATCH_NOT_FOUND`.
  - `match_start`: status must be `upcoming` else 409 `ILLEGAL_TRANSITION`.
  - `score` `{team_id, event_type}`: requires `in_progress` else 409 `MATCH_NOT_IN_PROGRESS`; team not home/away → 400; event_type not in sport `scoring_events` → 400 `UNKNOWN_EVENT_TYPE`.
  - `discipline` `{team_id, points:int}`: requires `in_progress`.
  - `tiebreak_winner` `{team_id}`: requires `in_progress`.
  - `match_end`: requires `in_progress` else 409 `ILLEGAL_TRANSITION`; scores level ∧ `draw_allowed=false` ∧ no active tiebreak_winner → 409 `TIE_NOT_ALLOWED`.
  - `compensation` `{compensates, reason}`: any status after init; target unknown → 404 `EVENT_NOT_FOUND`; target already compensated, not score/discipline/tiebreak_winner, or other match → 409 `INVALID_COMPENSATION`.
- Model limits (active events only): innings — team legal balls ≥ `innings_per_team*overs_per_innings*balls_per_over` or wickets ≥ `innings_per_team*wickets_per_innings` → 409 `INNINGS_COMPLETE`; round — team rounds ≥ `(best_of+1)/2` → 409 `SERIES_ALREADY_DECIDED`.
- Idempotency per C4 with code `DUPLICATE_EVENT_ID`; the event_id namespace is global.
- Response 201: `{event_id, match_id, type, sequence, match_version, signature}`; `sequence` = 1-based log position; `match_version` = log length after append; `signature = sign(event_id, payload)`.
- Projection (rebuilt on every read, no counters): `status`, `outcome` (`pending` | `home_win` | `away_win` | `draw` | `undecided`), `winner_team_id` (higher score, else active tiebreak winner, else null), `tiebreak_winner_team_id`, `home`/`away` `{team_id, score, wickets, balls, overs, fair_play}`; `wickets`/`balls`/`overs` non-null only for innings; `overs = "${floor(balls/bpo)}.${balls%bpo}"`; score = points (event) / runs (innings) / rounds (round) read from sport config fields by model; `version`; `events[]` with `{sequence, event_id, type, payload, signature, compensated, compensated_by}`. A compensated event and its compensation are neutral.
Done when: API tests cover every error code above, compensation after `match_end` changes outcome, a mystery sport of each model scores correctly, and signatures equal Python `sign()` from `S:1373-1378`.

### WP4 — Leagues and standings (`S:638-668`, `S:775-841`) — FR-1.4
Deps: WP3.
Files: `backend/src/standings/{leagues,compute}.js`, `backend/src/routes/standings.js` (`POST /audit/v1/leagues`, `GET /audit/v1/standings/:league_id`).
- Register: required `league_id, sport_id, teams (2–40 unique), fixtures[{match_id,home,away}]`, `qualification.spots` int 1..n. Optional `points` (default 3/1/0), `tie_break_order` (default sport's), `lots_seed` (default `lastResetSeed`). Errors: 404 `SPORT_NOT_FOUND`; fixture team not in teams or home=away → 400; 409 `LEAGUE_EXISTS`; 409 `MATCH_EXISTS` (any existing stream). Each fixture creates an `upcoming` match stream with league_id. 201 `{league_id, status:"created", team_count, fixture_count}`.
- Played = completed ∧ outcome ≠ undecided. A win via tiebreak_winner counts as a win.
- Row: `rank, team_id, played, won, drawn, lost, scored, conceded, diff, points, fair_play, status, resolved_by`.
- `diff`: event = scored−conceded; round = rounds won−lost; innings = NRR = runs_for/overs_faced − runs_against/overs_bowled, overs = legal_balls/bpo (decimal); an all-out innings counts as full `overs_per_innings`; round to 3 decimals.
- Ordering (exact, `S:814-827`): sort by points desc; `resolve(group)` iterates `tie_break_order` then `draw_lots`; the first criterion with unequal values splits the group into sub-groups (best first); each sub-group of size >1 recurses from the first criterion. `h2h_points`/`h2h_diff` use only matches among the current group. `draw_lots`: ascending `lotsKey`. `resolved_by` = criterion that placed the team above the next team tied on points; else null. `draw_lots` always applies last.
- Status (points only): W = win points, `max(T)=points(T)+W*remaining(T)`, k=spots; `clinched` if fewer than k others have `max(X) ≥ points(T)`; else `eliminated` if ≥k others have `points(X) > max(T)`; else `still_possible`.
- `h2h[a][b] = {played, points, scored, conceded}` for every ordered pair, zeros when never met.
- Response: `{league_id, sport_id, qualification_spots, table, h2h}`.
Done when: tests cover the 3-way mini-league tie (edge case 4), lots order matches vector 2, NRR for an all-out innings, and compensation flipping a result changes rank/status (edge case 5).

### WP5 — Swiss and double elimination (`S:528-571`, `S:603-637`) — FR-1.3
Deps: none (pure). Files: `backend/src/fixtures/{swiss,doubleElim}.js`, wire into `routes/fixtures.js`.
- Swiss: teams 2–64. `total_rounds` 1..n−1 (default ⌈log2 n⌉); `round` 1..total_rounds (default 1); `history` must contain exactly rounds 1..round−1 else 400. Score win 1, draw 0.5, loss 0, bye 1. Buchholz = sum of current scores of opponents actually played (bye contributes 0). Standings sorted by score desc, buchholz desc, seed asc. Round 1 exact: m=⌊n/2⌋, odd n → last seed bye, pair seed i with i+m, home = lower seed. Rounds ≥2: bye to the lowest-scoring team without a prior bye (tie → largest index); fall back to the next candidate if the rest is unpairable; the pairing must minimise Σ|score diff| over rematch-free pairings — use exhaustive backtracking with branch-and-bound (n ≤ 64; order candidates by score). None for any bye candidate → 409 `NO_VALID_PAIRING`, `details.round`. ids `SW-R{round}-M{i}`. Response `{format, round, total_rounds, pairings, bye, standings[{rank,team_id,score,buchholz}]}`.
- Double elim: teams 3–128; B and WR1 seeding identical to `singleElim.js` (reuse `seedOrder`). Winners `WR{r}M{i}`, r=1..k (B=2^k), B/2^r matches. Losers `LR{r}M{i}`, r=1..2(k−1); rounds 2j−1 and 2j have B/2^(j+1) matches; total B−2. `GF1`; `GF2` only if `bracket_reset:true`. Routing: WR1 losers pair in LR1; WR r≥2 loser → LR(2r−2); every WB match has `loser_to`; LB matches `loser_to:null`; every non-terminal match has `winner_to`; every slot except WR1 fed by exactly one source; WR final winner → GF1.home, WR final loser → LB final away, LB final winner → GF1.away. GF2 `conditional:true`, `required` null until GF1 has a result, then `bracket_reset && GF1.winner == GF1.away`. Apply `params.results` like single elim, propagating winners and losers. Response `{format, bracket_size, bracket_reset, winners, losers, grand_final}`.
Done when: property tests for n=2..64 (swiss: no rematch, ≤1 bye, optimality vs brute force for n≤10) and n=3..128 (double: id counts, graph in-degree = 1, GF2 required states).

### WP6 — Store checkout and inventory (`S:949-1022`) — FR-2.3, NFR-3
Deps: WP1, WP2.
Files: `backend/src/store/{inventory,gateway,receipt,checkout}.js`, `backend/src/routes/store.js`.
- Order: (1) validate: `order_id` id, `customer_id` string, `items` 1–10, unique variant_ids, quantity int 1..10, `discount_code` null|string, `payment.token` string → 400; (2) unknown variant → 404 `VARIANT_NOT_FOUND`; (3) code ≠ `WELCOME10` → 400 `INVALID_DISCOUNT_CODE`; (4) idempotency by `order_id` (C4, `DUPLICATE_ORDER_ID`) — check before reserving; (5) reserve all items atomically in one synchronous block (all-or-nothing) else 409 `OUT_OF_STOCK` `details.variant_id`; (6) gateway: `tok_success` → auth+capture; `tok_declined` → release, 402 `PAYMENT_DECLINED`; `tok_capture_fail` → void auth, release, 402 `PAYMENT_CAPTURE_FAILED`; (7) commit: `stock -= qty`, `reserved -= qty`, status `paid`.
- Any `await` between reserve and commit must keep `reserved` accounting correct; `reserved` must be 0 after all requests finish.
- Totals: `subtotal = Σ qty*unit_price`; `discount = floor(subtotal*10/100)`; `total = subtotal − discount`.
- Response 201 `S:991-1007`: `payment {authorization_id, capture_id, state:"captured"}`; `receipt.payload {order_id, customer_id, items, subtotal_minor, discount_minor, total_minor, currency, paid_at}`; `receipt.signature = sign(order_id, receipt.payload)`; `receipt.pdf_base64` = pdfkit PDF whose text contains the order_id and `PKR 4500.00` format (`(total/100).toFixed(2)`, no thousands separator).
- Order state machine `pending→paid→packed→shipped→delivered`, `cancelled`, `refunded`; publish each transition to RabbitMQ (`RABBITMQ_URL`) best-effort, never blocking the response.
- `GET /audit/v1/inventory/:variant_id` → `{variant_id, stock, reserved}`; unknown → 404.
Done when: pytest fires 20 threads behind a `threading.Barrier` on stock 1 → exactly one 201, nineteen 409, stock 0, reserved 0; a declined payment restores stock; the receipt signature verifies in Python; PDF bytes start with `%PDF` and extracted text matches.

### WP7 — Roster, transfers, loans (`S:842-948`) — FR-2.2
Deps: WP2.
Files: `backend/src/roster/{store,rules,history}.js`, `backend/src/routes/roster.js`.
- `POST /audit/v1/roster/setup`: replaces state for that `league_id`; `max_squad_size`/`required_positions` default from the sport roster config; roles `captain|vice_captain|starter|substitute`. 201 `{league_id, status:"configured", squad_counts}`.
- `POST /audit/v1/roster/transfer` checks in exact order: 1 schema (`type` transfer|loan|release; `to_squad_id` required unless release; `loan_end_date` required and > `effective_date` only for loan) → 400; 2 → 404 `LEAGUE_NOT_FOUND` / `PLAYER_NOT_FOUND` / `SQUAD_NOT_FOUND`; 3 squad tenant ≠ league tenant → 409 `CROSS_TENANT_TRANSFER`; 4 current squad (as of effective_date) ≠ from → 409 `NOT_IN_SQUAD`; 5 transfer/loan date outside the inclusive window → 409 `TRANSFER_WINDOW_CLOSED`; 6 on active loan → 409 `PLAYER_ON_LOAN`; 7 destination count+1 > max → 409 `SQUAD_FULL`; 8 from squad below required count for the player's position after the move → 409 `MIN_POSITION_VIOLATION`.
- Effects: transfer → role substitute, vacate captain/vice slot; loan → borrower owns the player from effective through loan_end inclusive, `parent_squad_id` = lender, counts toward the borrower only; release → no squad. Player in `matches_in_progress` squad → accepted with `state:"deferred_until_match_end"`, `blocking_match_id`; else `active`/null.
- Audit entry ids `au-0001`… sequential; `who` = requested_by (or `"system"`), `when` = server time, `why` = reason. Rejections write nothing. Idempotency by `request_id`.
- `GET /audit/v1/roster/history/:player_id?as_of=` (default today): before responding, materialise `loan_return` entries for loans with `loan_end_date < as_of` exactly once; respond `{player_id, as_of, league_id, current_squad_id, parent_squad_id, history}` oldest-first. `base_version` for offline sync = audit entry count of the player.
Done when: one test per rule in order-precedence pairs, edge case 6, and a repeated history call with no duplicate `loan_return`.

### WP8 — RBAC and security (`S:1023-1101`) — FR-5.1, NFR-5
Deps: WP2.
Files: `backend/src/rbac/{jwt,policy,middleware}.js`, `backend/src/routes/rbac.js`, `backend/src/security/rateLimit.js`, `backend/src/routes/api.js`.
- `JWT_SECRET` from env (add to compose `JWT_SECRET: ${JWT_SECRET:-dev-only-secret}` and `.env.example`). Sign HS256, exp ≥ 1 h. Verify with `algorithms:['HS256']` pinned; reject `none`, a tampered signature or an expired token → 401 `UNAUTHENTICATED`.
- `POST /audit/v1/rbac-matrix` → `{tokens:{super_admin, league_organizer, club_manager, player, viewer}, context:{…}}` exactly as `S:1028-1038`.
- Policy-as-code: one table `policy[probe](principal, target) → bool` encoding the matrix `S:1063-1080`. Evaluate auth before anything else. Missing target id → 404; cross-tenant for non-super-admin → 403 `FORBIDDEN`. Probes: P1 `POST /audit/v1/rbac/tenants`; P2 `POST …/leagues/:id/fixtures`; P3 `POST …/clubs/:id/roster`; P4 `POST …/clubs/:id/products`; P5 `PATCH …/players/:id`; P6 `GET …/clubs/:id`; P7 `GET …/platform/config`. Allowed → 200 `{"authorized":true}`.
- `GET /api/v1/ping` → 200 `{"pong":true}`; limiter on `/api/v1/*` only: 100 req / rolling 10 s / IP; excess → 429 `RATE_LIMITED` + `Retry-After` seconds.
Done when: a parametrised test over all 5 roles × every matrix row; alg-none, tampered and expired tokens → 401; 150-request burst → first 200, ≥40 × 429 with Retry-After, 200 again after 11 s.

### WP9 — Offline sync (`S:1102-1168`) — NFR-4
Deps: WP3, WP7.
Files: `backend/src/offline/sync.js`, `backend/src/routes/offline.js`.
- Envelope: `device_id`, `actions` 1–100 `{action_id, type: score_event|roster_transfer, queued_at, base_version, payload}`; else 400.
- Process sorted by `queued_at` asc (stable on array order); return results in request order with `processed_order`.
- Per action: (device_id, action_id) already processed, or identical event_id already stored → `duplicate`/`skipped_duplicate`; unknown match/player/squad → `rejected`/`server_wins`/`*_NOT_FOUND`; `base_version > current` → `rejected`/`server_wins`/`INVALID_BASE_VERSION`; domain rule rejects → `rejected`/`server_wins`/that code; `base_version == current` → `applied`/`appended`; `< current` → `applied`/`rebased_append`. Apply through the same WP3/WP7 service functions as the HTTP routes.
- `server_version` = match version / player audit count after processing; `signature` for applied score_event, else null. `summary {applied, rejected, duplicate}`. Always HTTP 200. Re-sending the same envelope → all duplicate.
Done when: the spec example reproduces; a replay is all-duplicate; ordering by queued_at is verified.

### WP10 — Mobile-facing API
Deps: WP2–WP8.
Files: `backend/src/routes/api.js`.
- `POST /api/v1/auth/login {email,password}` → `{token, role, tenant:{id,name,logo,colors}, scope_ids}`.
- Read endpoints (JWT, tenant-scoped through the WP8 policy): leagues, fixtures/matches with status+time, score (reuse WP3 projection), standings (WP4), club profile (club, roster, staff, venue), products + variants. Write endpoints delegate to WP3/WP6/WP7/WP9 services.
- Realtime: SSE `GET /api/v1/matches/:id/stream` pushing the projection on each append.
Done when: every screen in WP11 is served by one documented endpoint; the rate limit applies.

### WP11 — Mobile app (`S:1214-1294`)
Deps: WP10.
Location: `mobile/` (React Native, Android). Output: `mobile/release/app-release.apk` (API ≥ 29).
- Settings: editable server URL (default `10.0.2.2:8080`).
- Token in Android Keystore (`react-native-keychain`).
- Screens: Login, Fixtures, Match detail (live score via SSE, timeline, pinned product), Standings (qualification status), Club profile, Store (catalogue → variant → cart → checkout → receipt view/download), Roster management (manager: add/transfer/loan/release), Scoring entry (organizer: score + compensation), and an always-visible sync indicator + pending queue.
- Offline: cache fixtures/standings/club in SQLite; queue actions in SQLite in the WP9 action format; survive force-close; auto-sync on reconnect plus a Sync button; per-action result with plain-language reasons.
- UI: tenant colours/logo, 48 dp targets, labelled icons, no raw error codes, empty states, confirmation before risky actions, works at 360×640 and on rotation; role-gated navigation.
Done when: the §8.4 desk-check script passes on a device in airplane mode, and judge tasks A–C (`S:1278-1280`) complete without dead ends.

### WP12 — Tests and coverage (`S:1337-1342`)
Deps: each WP adds its own tests.
- Add `c8`; `run_tests.sh` runs `c8 --reporter=json-summary node --test tests/unit/*.test.js`, then pytest.
- `scripts/coverage.js` maps the c8 summary by directory (`fixtures`, `scoring`, `standings`, `store`, `roster`, `rbac`) to `COVERAGE.json` `{fixtures, scoring, standings, store, roster, rbac}` line % (1 decimal). Never declare a value above the measured one.
- Target ≥ 85% per area.

### WP13 — Submission artefacts
- `TRACEABILITY.md`: every FR/NFR row → real `backend/src/...` paths + test files + status.
- `ADR.md`: 8 ADRs (in-memory stores + reset; event sourcing; HMAC canonical JSON; synchronous atomic reservation; policy-as-code RBAC; JWT alg pinning; Swiss backtracking; offline sync conflict policy).
- `README.md`: run instructions, 5 demo accounts, mobile build.
- `.env.example`: every env var, placeholder values only.
- Fix `sports/validate.js`: reject repeated `tie_break_order` tokens; standings always append `draw_lots`.

## 3. Verification gate (before every push)

1. `DAY1_SALT=<placeholder> docker compose -p gate up -d --build` from a copy of only the git-tracked files: build < 600 s; `/health` 200 within 120 s without `/reset`.
2. `./run_tests.sh` green.
3. `grep -r "<real salt>"` over tracked files → no match.
4. Response JSON compared field by field against the spec examples for every touched endpoint.
5. `docker compose -p gate down -v`.

## 4. Point map (Phase I reference for prioritisation)

| Area | Points | WP |
|---|---|---|
| Six backend areas: fixtures ×4, scoring, standings, store, roster, RBAC/security | 36 total (per-area split not specified) | WP3–WP8 |
| Offline sync script + desk check | 4 | WP9, WP11 |
| Mobile UI/HCI | 10 | WP11 |

Each backend area scores `0.9P·(passed/|V|) + 0.1P·[coverage ≥ 85%]`, with |V| ≥ 40 hidden vectors and no partial credit within a vector (`S:1317-1336`).
