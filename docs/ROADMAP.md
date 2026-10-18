# ROADMAP — Day 2 minimal path (Part II)

Specs: Day 2 = `App Dev Day 2 Problem Statement.md` at repo root (cited `D2:<lines>`, not committed). Day 1 = `docs/NaSCon_26_App_Dev_Part_1.md` (`D1:<lines>`). State: `docs/STATUS.md`.
Grading: 80% backend + QA infra (contracts, signatures, media, load, grid), 20% frontend (Guest Web Player + mobile) (`D2:862-888`). Phase I score is locked; Phase I work is in scope only where Day 2 depends on it.

## 0. Hard constraints

| ID | Constraint |
|---|---|
| C1 | `/audit/v1/*` shapes, status codes, error codes and signatures are compared literally (`D2:233-236`). |
| C2 | Error envelope `{"error":{"code","message","details"}}`; validation order 400 → 404 → 403 → 409 (`D2:281-293`). Use `ApiError` + `sendError`. |
| C3 | `DAY2_SALT` from env only. A hard-coded salt voids the module (`D2:904`). Compose forwards `DAY1_SALT: ${DAY1_SALT}` and `DAY2_SALT: ${DAY2_SALT}`. |
| C4 | Ports: API + `/web/*` + `/metrics` 8080; RTMP 1935; HLS 8888; WebRTC 8889; Selenium hub 4444 (≥3 ready nodes); Appium 4723 (`D2:656-675`). |
| C5 | `DAY1_SALT=… DAY2_SALT=… docker compose up -d --build` → every container healthy and `/health` 200 within 120 s (`D2:267`, `D2:900`). |
| C6 | Push checkpoints (GitHub server time, PKT): W1 10:15–11:30 ✅ `86500bc`; W2 11:30–12:45 ✅ `50bb624`; W3 12:45–13:45 ✅ `8f7a79c` 12:48; W4 13:45–14:00 (still needed). **Final push ≤ 14:05:00** (written, binding, `D2:12`, `D2:89`). The verbal 14:20 extension conflicts with the binding document (`D2:22`): treat 14:05 as the deadline unless the organizers confirm 14:20 in writing. |
| C7 | History must descend from `3001bc2` (`git merge-base --is-ancestor`). Never rewrite history. |
| C8 | Phase I regression: Phase I unit tests and `/audit/v1/reset` probes must keep passing (`D2:46`). Keep the Day 1 reset response keys. |
| C9 | All state resets in `seedBaseline()` (`backend/src/seed.js`), which runs on boot and on `/audit/v1/reset`. |
| C10 | `/audit/v1/*` is not rate limited (k6 runs 550 VUs). |
| C11 | Never commit the PDFs, `App Dev Day 2 Problem Statement.md` or `.env`. |

## 1. Decisions on spec ambiguities (apply as written; change only on written organizer answer)

| # | Ambiguity | Decision |
|---|---|---|
| A1 | `flagged_count` in moderation sig_payload | Count of `filtered_messages` with `flagged:true` (profanity). Dropped flood messages are not counted. |
| A2 | Flood sender: kicked or muted | `muted_users` only (binding §5.8 rule 3 and example `D2:598`, `D2:627-628`). Profanity sender → `kicked_users` only. |
| A3 | `kicked_users`/`muted_users` scope | Per request: deduplicated, in violation order. Room-level sets are stored separately for the chat bus. |
| A4 | `test_write_block:false` | `write_block_verified:false`, `write_rejection_code:null` (sig_payload uses null). |
| A5 | How the grader postpones a match (`D2:921-928`) | `/audit/v1/events` accepts `type:"match_status"` `{status: postponed|cancelled|abandoned|upcoming}` plus aliases `match_postpone`, `match_cancel`, `match_abandon` (empty payload). |
| A6 | `COVERAGE_DAY2.json` module names (empty in spec `D2:894-896`) | `{"streaming","costream","qr","guest","moderation"}`. |
| A7 | Stream-key sig_payload | Full 4-key `{action, player_id, status, stream_key}` (`D2:302`); 2-key form also accepted by grader. |
| A8 | `generate` when a key is active | Invalidate the old key, return the new one with 201. |
| A9 | `registered_user_id` domain | Player ids. Every seeded player has a user/cart record. |
| A10 | Guest guard on Day 1 no-auth `/audit/v1/*` | Only when `Authorization: Bearer guest_…` is present on a write route → 403 `GUEST_WRITE_FORBIDDEN` before validation. No header → Day 1 behaviour. |
| A11 | QR for entities without a seeded mapping | Created lazily for any existing `match-*`, `club-*`, `player-*`, `cs-session-*`; `short_code = "q-" + sha256(entity_id)[0:10]`; stable once created. |
| A12 | Unknown `/q/{short_code}` | 404 `QR_NOT_FOUND` JSON. |
| A13 | `/health` deps (`D2:242`) | DB + Redis PING + MediaMTX API (`http://mediamtx:9997/v3/config/global/get`), each with a 1 s timeout, plus the seeded flag. |
| A15 | Co-stream check order with only 4 seeded players | Capacity (409 `COSTREAM_SESSION_FULL`) is checked right after schema, before player existence, so the catalogue code is reachable. |
| A16 | Chat sender rate limit (3 msgs / 2 s) | Applied to live chat `POST /api/v1/chat` only (429 `RATE_LIMITED`), never to `/audit/v1/moderation/test`: the edge-case-3 probe sends 10 identical concurrent requests and must return identical results. |
| A14 | Revoked key on ingest | MediaMTX `authMethod: http` → `POST /internal/media/auth`: active key → 200; revoked → 409 `KEY_REVOKED`; unknown → 404. Revoke/rotate also kicks live sessions via the MediaMTX API (`/v3/rtmpconns/kick/{id}`, `/v3/webrtcsessions/kick/{id}`). |

## 2. Execution order

Tiers are ordered by points per hour. Within a tier, packages own disjoint files and can run in parallel. Every package: implement → unit test (`tests/unit/`) → pytest contract test (`tests/test_<area>.py`) → push.

### Tier 0 — foundation ✅ DONE `50bb624` (gate: /health 200 at 15 s, grid 3 nodes at 18 s, 116 API + 17 unit tests)

**P0.1 Compose + infra.** Files: `docker-compose.yml`, `mediamtx.yml`, `.env.example`.
- Add `DAY2_SALT: ${DAY2_SALT}` to backend env.
- `mediamtx` service `bluenviron/mediamtx:1.9.1` (pre-pulled), ports 1935/8888/8889 (+8889/udp, 8189/udp), API 9997 internal, config mounted, `authMethod: http`, `authHTTPAddress: http://backend:8080/internal/media/auth`.
- MinIO: dropped (image unavailable on Docker Hub, quay.io and Bitnami; treated as a decoy). VOD recording is out of scope.
- Selenium per `D2:682-723`: hub + `node-chrome-1`, `node-chrome-2`, `node-firefox`, each `shm_size: "1gb"`, `SE_START_VNC=false`. Use tag `4.24.0` (pre-pulled; spec text says 4.25.0, which is not graded).
- Healthchecks on every service; backend `depends_on` postgres/redis/mediamtx healthy.
- Done: clean-copy `up -d --build` < 120 s to `/health` 200; `curl :4444/status` → `value.ready==true`, nodes ≥ 3.
- Gate note: `selenium-hub` has a fixed `container_name`; run `docker compose down` on the main stack before starting a gate project.

**P0.2 Day 2 core utils + seed.** Files: `backend/src/utils/sign.js`, `backend/src/seed.js`, `backend/src/day2/store.js`, `backend/src/auth/guest.js`.
- `canonical(obj)` (recursive key sort, `,`/`:` separators, no ASCII escaping) and `signDay2(entityId, payload)` = HMAC-SHA256(`DAY2_SALT`, `entityId + "|" + canonical(payload)`) → lowercase hex. Also `signDay1` for Phase I.
- Unit test reproduces Python `sign_day2` for both vectors `D2:956-990` (compute the expected hex with the Appendix reference code and hard-code it).
- Seed additions (`D2:269-279`): `player-beta-2` in `club-beta-1`; users/carts for all players (empty carts); guest token `guest_anon_tok_7721` (valid, unmerged); QR mappings `match-m1`→`m1-live`, `player-alpha-1`→`p-alpha-1`, `club-alpha-1`→`c-alpha-1`, scan_count 0; match `match-m1` (football, league-alpha-1, home `club-alpha-1`, away `club-alpha-2`) created as the event log `match_init → match_start → score{team_id: club-alpha-1, event_type: first scoring_events key of the sport}` so its status is `in_progress` and the score 1–0; DLQ empty; co-stream sessions, stream keys, chat rooms, scan telemetry, metrics counters cleared.
- `auth/guest.js`: `isGuestBearer(req)`; middleware `guardWrite` → 403 `GUEST_WRITE_FORBIDDEN`, `details.guest_token`.
- Done: two resets give identical state; Day 1 `tests/` still green.

**P0.3 Minimal match engine (Phase I subset needed by Day 2).** Files: `backend/src/scoring/*`, `backend/src/routes/events.js`.
- `POST /audit/v1/events` with `guardWrite` first, then the Day 1 rules `D1:669-735` for `match_init`, `match_start`, `score`, `discipline`, `tiebreak_winner`, `match_end`, `compensation`, plus A5 status events. Signature = `signDay1(event_id, payload)`. Idempotency per `event_id`.
- `GET /audit/v1/score/:match_id` projection rebuilt from the log (`D1:736-774`); status adds `postponed|cancelled|abandoned`.
- Emits `match.updated` on the in-process bus (P1.6) after every append.
- Done: match_end/postpone on `match-m1` changes the projection; guest bearer → 403.

### Tier 1 — Day 2 contracts ✅ DONE `dc96b7f` 12:08 (160 API tests incl. DAY2 signature recomputation; gate /health 12 s, grid 16 s). W3 (12:45–13:45) still needs its own push.

**P1.1 Stream keys (`D2:320-372`).** Files: `backend/src/streaming/*`, `backend/src/routes/stream.js`, `/internal/media/auth`.
- Validate `action ∈ {generate, rotate, revoke}`, `player_id` required, `label` 1–64 (default `"default"`), `stream_key_override` optional → 400. Unknown player → 404 `PLAYER_NOT_FOUND`. Revoke with no key → 404 `STREAM_NOT_FOUND`.
- Key `stream_key_override` or `sk_live_` + 16 hex. generate 201; rotate/revoke 200. Active response: `ingest_endpoints {rtmp: rtmp://localhost:1935/live/{k}, webrtc: http://localhost:8889/live/{k}/whip}`, `playback_url http://localhost:8888/live/{k}/index.m3u8`; revoked → `status:"revoked"`, both null.
- `signature = signDay2(stream_key, {action, player_id, status, stream_key})`. A14 auth hook and kick. `nascon_active_streams_total` / `nascon_stream_bitrate_kbps` read from the MediaMTX API (`/v3/paths/list`).

**P1.2 Co-stream (`D2:374-429`).** Files: `backend/src/costream/*`, `backend/src/routes/costream.js`.
- Checks in order: schema (`session_id`, `host_player_id` strings; `participants` non-empty unique strings; `layout ∈ solo|grid_2|grid_4|spotlight` default `grid_4`; `simulate_host_drop` bool default false) → 400; any unknown player → 404 `PLAYER_NOT_FOUND`; host ∉ participants → 400 `VALIDATION_ERROR` `fields:["host_player_id"]`; `len > 4` → 409 `COSTREAM_SESSION_FULL`; effective count (after a drop) > 1 for solo or > 2 for grid_2 → 400 `UNSUPPORTED_LAYOUT`.
- Drop logic exactly as `D2:404-408`. Response keys `D2:412-428`; `composite_playback_url http://localhost:8888/costream/{id}/index.m3u8`; `chat_room_id "chat-{id}"`. 201 first; identical replay 200; a different body for an existing id re-evaluates and stores it (200).
- `signature = signDay2(session_id, {active_host, handoff_occurred, layout, participant_count, session_id, status})`.
- Creates chat room `chat-{id}` with a monotonic `seq` (P1.6).

**P1.3 QR (`D2:431-487`).** Files: `backend/src/qr/*`, `backend/src/routes/qr.js`. Deps: npm `qrcode`, `pdfkit`.
- `GET /audit/v1/qr/:entity_id[?inspect=true]`: resolve the mapping (A11), else 404 `QR_NOT_FOUND`. Increment `scan_count` unless `inspect=true`; telemetry stores only `{device_family: mobile|desktop from UA regex, bucket: UTC hour}`, never IP/UA. `target_route` computed at request time from the live state (`D2:463-475`). Response keys `D2:439-455`, `deep_link_uri nascon://entity/{id}`.
- `signature = signDay2(entity_id, {entity_id, short_url, target_route})`.
- `GET /q/:short_code` → 302 `Location: <target_route>` (relative path), counts a scan; unknown → 404 JSON.
- Exports: `.svg` (`image/svg+xml`, QR of short_url), `.png` (`image/png`), `.pdf` (`application/pdf`, PNG QR + entity_id + short_url text). Unknown format → 404.
- `nascon_qr_scans_total` counter.

**P1.4 Guest boundary + cart merge (`D2:490-551`).** Files: `backend/src/guest/*`, `backend/src/routes/guest.js`, guard wiring in `routes/events.js`, `routes/store.js`, `routes/chat.js`.
- `POST /api/v1/guest/token` → `{guest_token:"guest_anon_tok_"+random, role:"guest", expires_at}` (short-lived, read-only scope). `GET/POST /api/v1/guest/cart` (staging; allowed for guests).
- `POST /audit/v1/checkout` and `POST /api/v1/chat` exist with `guardWrite` first (checkout body logic may be a stub beyond the guard).
- Cart merge order: 400 schema (`guest_token` starts with `guest_`, `registered_user_id` string, `guest_cart` 1–10 `{variant_id, quantity int ≥ 1}`, `test_write_block` bool default true) → 404 `PLAYER_NOT_FOUND` / `VARIANT_NOT_FOUND` → idempotency: token already merged with an identical `(token, user, cart)` → 200 stored response; otherwise → 409 `GUEST_TOKEN_ALREADY_MERGED` → stock: `existing_qty + guest_qty > stock` → 409 `OUT_OF_STOCK` `details.variant_id` → write-block simulation calls `guardWrite` internally and records 403 → merge in one synchronous block (sum quantities per variant), mark the token merged, no inventory reservation.
- Response 200 `D2:525-546`: `active_cart {user_id, currency "PKR", total_items = Σqty, subtotal_minor, items[{variant_id, quantity, unit_price_minor}]}`.
- `signature = signDay2(guest_token, {cart_merged, guest_token, registered_user_id, total_items, write_rejection_code})`.

**P1.5 Moderation + DLQ (`D2:553-635`, `D2:193-200`).** Files: `backend/src/moderation/*`, `backend/src/notify/dlq.js`, `backend/src/routes/moderation.js`.
- Per message, in order: flood (`/(.)\1{3,}/i` over the raw text, or `/[!?]{3,}/`) → drop, sender → `muted_users`; else profanity → mask, `flagged:true`, `reason:"profanity_leetspeak"`, sender → `kicked_users`; else clean `flagged:false`, `reason:null`.
- Profanity: split on whitespace; for each token peel leading/trailing `[^A-Za-z0-9@$!*_.\-]`, then strip trailing `[!?.,]`; build candidates by lowercasing, removing `_ . - *` and zero-width chars, mapping `@→a 0→o 3→e $→s 1→i`, and `!` both →`i` and → removed; flagged if any candidate equals a dictionary word (dictionary normalized the same way): `badword, bad_word, porn, scam, fuck, shit, bitch, asshole, idiot_spam`. Replace the token core with `***`, keeping the peeled punctuation (`b@d_w0rd now!` → `*** now!`).
- Sender rate limit (FR-5.3): > 3 messages / 2 s per sender (room-level sliding window) → drop, `muted_users`. It never changes the HTTP status (k6 requires 200).
- DLQ: `simulate_failed_notifications = N` → N notifications each go through 3 delivery attempts (backoff 10/20/40 ms), then append `{event_id, type, attempts:3, last_error, failed_at}` to the DLQ (module-level array, reset on `/reset`). `dlq_status {queue_depth, undelivered_events}` always present.
- Concurrency (`D2:929-934`): fully synchronous handler; no shared mutable list returned by reference.
- `signature = signDay2(chat_room_id, {chat_room_id, flagged_count, kicked_users, queue_depth})` (A1).
- `nascon_dlq_depth` gauge.

**P1.6 Realtime bus + metrics + privacy.** Files: `backend/src/realtime/*`, `backend/src/routes/metrics.js`, `backend/src/routes/privacy.js`. Deps: npm `ws`.
- In-process EventEmitter bus. WS `ws://localhost:8080/ws/matches/{id}` and SSE `GET /api/v1/matches/{id}/stream` push the score projection immediately on connect and on every `match.updated` (NFR-1: p95 < 500 ms for 25 clients). WS `/ws/chat/{room}` broadcasts accepted chat with a room `seq`.
- `GET /metrics` `text/plain; version=0.0.4` with HELP/TYPE lines for `nascon_active_ws_connections`, `nascon_active_streams_total`, `nascon_stream_bitrate_kbps`, `nascon_dlq_depth`, `nascon_qr_scans_total`.
- `DELETE /audit/v1/privacy/user/:user_id`: unknown → 404 `PLAYER_NOT_FOUND`; anonymize the name/email, revoke the user's JWTs and linked guest tokens → 200 `{user_id, status:"anonymized", pii_retained:false, tokens_wiped:true}`.

### Tier 2 — Guest Web Player ✅ DONE (Selenium 6/6 ×3 runs, chrome+firefox in parallel; progressive sign-in → cart merge → held chat verified in browser)

**P2.1 `/web/*`.** Files: `backend/src/web/` (static HTML/CSS/JS), `backend/src/routes/web.js`. Serve `hls.js` from `node_modules` (no CDN; runtime has no internet).
- Routes: `/web/matches/:id/{preview,live,vod,notice}`, `/web/players/:id`, `/web/clubs/:id`, `/web/costream/:id`.
- On load, obtain a guest token (`POST /api/v1/guest/token`, kept in `sessionStorage`); no login wall.
- Live page data-testids (`D2:731-753`): `guest-video-player` (`<video>` + hls.js on the stream playback URL, visible even when offline), `live-score-banner` (text `"H - A"`, updated via WS/SSE), `pinned-merch-card` (prod-jersey-001 / var-jersey-001-L), `add-to-guest-cart-btn` (adds L qty 1 → `guest-cart-count` `"0"`→`"1"`), `chat-message-list`, `chat-input-field`, `chat-send-btn` (POST `/api/v1/chat` with the guest token → 403 → do not append, show `progressive-auth-modal`), `progressive-auth-modal` (hidden at load; login form → `POST /api/v1/auth/login` → cart merge → return to the same playback time).
- WCAG 2.1 AA: contrast ≥ 4.5:1, focusable controls in DOM order, `aria-label` on media controls, targets ≥ 48×48 px, `<html lang>`, visible focus ring.
- `POST /api/v1/auth/login {email,password}` → JWT (demo users, `Nascon@26`).

### Tier 3 — QA harness + CI ✅ DONE `8f7a79c` (contract 160, Selenium 6/6, Appium skips without device, k6 0.00% failed p95 ~154 ms, COVERAGE_DAY2 measured)

**P3.1 Selenium** ✅ `tests/selenium/test_guest_grid.py` (each test uses its own match where it mutates state, so parallel workers never race): `webdriver.Remote("http://localhost:4444/wd/hub")`, browsers chrome and firefox; base URL `http://backend:8080` (inside the grid network); the 3 tests from `D2:755-763`; run `pytest -n 3 tests/selenium/ --junitxml=tests/reports/selenium-report.xml`. Add `pytest-xdist` and `selenium` to `tests/requirements.txt`.
**P3.2 k6** `tests/k6_load.js` verbatim from `D2:795-846`. Run `docker run --rm --network host -v "$PWD/tests:/tests" grafana/k6:0.54.0 run --summary-export=/tests/reports/k6-summary.json /tests/k6_load.js`; must pass the thresholds.
**P3.3 Appium** `tests/appium/test_mobile_deeplink.py`: Appium-Python-Client against `http://localhost:4723`; fire the two deep links (`D2:783-784`) via `mobile: deepLink`; assert the foreground activity; skip with a reason if `/status` is unreachable; JUnit → `tests/reports/appium-report.xml`.
**P3.4 CI** `.github/workflows/autograde.yml` on push to main: checkout (fetch-depth 0) → ancestry check vs `3001bc2` → `docker compose up -d --build` with `DAY1_SALT`/`DAY2_SALT` from repo secrets (fallback dummy) → wait for `/health` and grid ready → `./run_tests.sh` → Selenium → k6 → upload `tests/reports/`.
**P3.5 Artefacts**: commit generated `tests/reports/*`; `COVERAGE_DAY2.json` (A6) from c8 per module dir — declare measured values only; `TRACEABILITY.md` rows FR-3.1, 3.2, 3.3, 4.1–4.4, 5.2, 5.3, NFR-1, 2, 6, 8, 9 with paths + tests; README Day 2 run section.

### Tier 4 — Native mobile ✅ BUILT (`mobile/release/app-release.apk`, Java WebView shell, package `com.nascon.live`). Verified on SM-A035F (API 33): both spec deep links open the right route in 184–292 ms (AOT-compiled). Scanner crash fixed (androidx.core); on-device re-check pending (phone locked)

**P4.1 Android shell app** `mobile/` (Kotlin, single Activity + WebView), output `mobile/release/app-release.apk`:
- Manifest intent-filter `nascon` scheme exactly as `D2:772-779`; `nascon://entity/{id}` → WebView `/web/matches/{id}/live` (or player/club route); `nascon://stream/{id}` → `/web/costream/{id}`. No login screen on deep link. Foreground in < 2 s.
- Settings: backend base URL (default `http://10.0.2.2:8080`).
- QR scanner: ZXing (`journeyapps:zxing-android-embedded`) → open the scanned URL in the WebView.
- Broadcaster (FR-3.2/3.3 mobile UI): only if time remains; WHIP publish from a WebView page `/web/broadcast/{key}` using `getUserMedia` + WHIP to `:8889`.

### Deferred (no Day 2 points)
Phase I standings, Swiss, double elimination, roster, offline sync, full checkout/PDF receipts, RBAC matrix. FR-3.1 follow graph and VOD recording to MinIO: implement only if all tiers above are pushed.

## 3. Pre-push gate (each checkpoint)

1. `node --test tests/unit/*.test.js` and `pytest tests/ --ignore=tests/selenium --ignore=tests/appium` green against the local stack.
2. Clean-copy simulation: copy git-tracked files only → `DAY1_SALT=x DAY2_SALT=y docker compose -p gate up -d --build` → `/health` 200 ≤ 120 s, `:4444/status` ready with ≥ 3 nodes → `docker compose -p gate down -v`.
3. `git grep -n "<real DAY1/DAY2 salt>"` → empty.
4. `git merge-base --is-ancestor 3001bc2 HEAD`.
5. Push; record the SHA and server time in `docs/STATUS.md`.

## 4. Time plan (PKT)

| By | Done | Push |
|---|---|---|
| 12:05 | Tier 0 | W2 |
| 13:15 | Tier 1 | W3 (before 13:45) |
| 13:40 | Tier 2 | — |
| 13:55 | Tier 3 | W4 (13:45–14:00) |
| 14:05 | Final push, hard lock | final |
