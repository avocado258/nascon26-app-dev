# Architecture Decision Records

Each record lists context, decision, and consequences. Code paths are relative to `backend/src/`.

## ADR-1: In-memory domain stores, rebuilt by one `seedBaseline()`

**Context.** The grader calls `POST /audit/v1/reset` before every test group and needs identical state every time (D1 5.5, D2 5.2). It also polls `/health` before the first reset (D1 5.2). Requests must finish in < 5 s, including 550 concurrent k6 VUs.

**Decision.** Domain state lives in per-module in-memory `Map`s (`state/registry.js`, `scoring/engine.js`, `qr/`, `guest/`, `costream/`, `streaming/`, `notify/dlq.js`). Each module registers a reset hook through `registerReset()` in `seed.js`. `seedBaseline()` runs once on boot and again on every reset. Postgres stays in the stack for schema/migration and readiness, and Redis and MediaMTX are checked by `/health`.

**Consequences.** Reset is deterministic and takes milliseconds, and `/health` is 200 within ~12 s of `compose up`. State does not survive a container restart. That is acceptable because every grading run starts with `/reset`, and the restart re-seeds. Horizontal scaling would need these stores moved to Postgres/Redis.

## ADR-2: Event-sourced match engine; the score is always a projection

**Context.** Scores must be rebuilt from an append-only log. Corrections are compensating events, never mutations (D1 FR-1.1, 5.9). The QR target route (D2 edge case 2) and the live banner (NFR-1) depend on the live match state.

**Decision.** `scoring/engine.js` appends signed entries to a per-match log. `project()` recomputes status, score, wickets/overs, fair play, tie-break and outcome from the log on every read. Scoring reads `points`/`runs`/`rounds` from the sport config by `scoring_model`, so no sport or event name appears in domain logic (−8 penalty). Postpone, cancel and abandon are log events too (`match_status` + aliases, decision A5).

**Consequences.** Compensation after `match_end` flips outcomes with no special cases. QR routes and banners can never disagree with `/score`. Reads are O(log length), which is fine at match scale.

## ADR-3: One canonical-JSON HMAC helper, salts read at call time from env

**Context.** Day 1 and Day 2 signatures are compared byte-for-byte (D1 5.3, D2 5.3). A hard-coded salt voids the module (D2 7.3).

**Decision.** `utils/sign.js` implements `canonical()` (recursive key sort, `,`/`:` separators, no ASCII escaping) and `hmac(salt, id, payload)`. `signDay1`/`signDay2` read `process.env.DAY1_SALT`/`DAY2_SALT` on every call. Compose forwards `${DAY1_SALT}` and `${DAY2_SALT}`, and the real salts live only in the git-ignored `.env`.

**Consequences.** One code path signs events, stream keys, co-streams, QR records, cart merges and moderation probes. Unit tests pin the spec vectors (D1 vector 1 `972a8b55…`, D2 vectors 1–2), and the API tests recompute every signature with the spec's Python reference. Each pre-push gate greps committed files for the real salts.

## ADR-4: Guest write boundary enforced server-side, before validation

**Context.** Any write with a `guest_anon_tok_*` bearer must return 403 `GUEST_WRITE_FORBIDDEN`. Hiding UI earns nothing (D2 FR-4.3, 5.7, 7.3). Day 1 `/audit/v1/*` routes take no auth header.

**Decision.** `auth/guest.js` `guardWrite` is the first middleware on every state-mutating route (`/audit/v1/events`, `/audit/v1/checkout`, `/api/v1/chat`). It fires only when an `Authorization: Bearer guest_…` header is present (decision A10), so Day 1 no-auth behaviour is unchanged. Member writes use HS256 JWTs with the algorithm pinned (`auth/jwt.js`). Cart merge simulates a guest write through the same guard to fill `write_rejection_code`.

**Consequences.** A guest never learns request-shape details from a 400. The Guest Web Player treats the 403 as the trigger for the progressive sign-in modal, which Selenium test 2 verifies.

## ADR-5: Correctness under concurrency through synchronous critical sections

**Context.** Ten simultaneous moderation probes must return a deduplicated `kicked_users` without corrupting DLQ counters (edge case 3). A replayed cart merge must never double-add or double-reserve (edge case 4).

**Decision.** In Node's single-threaded event loop, `guest.merge()` and `moderation.runProbe()` run fully synchronously from check to commit, with no `await` between reading and writing state. `kicked_users`/`muted_users` are per-request ordered sets (decision A3). Merge idempotency keys on canonical `(token, user, cart)` and is checked before the stock check.

**Consequences.** No locks and no deadlocks. API tests show 10 concurrent probes all returning `["user-spammer"]` and 8 concurrent merge replays all returning `total_items: 1`. Moving these stores out of process would require atomic primitives such as a Redis `WATCH`/Lua script or Postgres row locks.

## ADR-6: MediaMTX as the media server; the backend authorises every publish and read

**Context.** We need RTMP ingest on 1935, HLS on 8888 and WHIP/WHEP on 8889 (D2 6.1). Revoking or rotating a key must cut ingest within 2 s, and later use of a revoked key returns 409 `KEY_REVOKED` (D2 5.4). The image must run self-hosted from the pre-pulled bundle.

**Decision.** `bluenviron/mediamtx:1.9.1` with `authMethod: http` pointing at `POST /internal/media/auth`. `streaming/keys.js` allows `live/{key}` only for an active key and returns 409 `KEY_REVOKED` for a revoked one. On revoke or rotate it kicks matching sessions through the MediaMTX control API (`/v3/{rtmpconns,webrtcsessions,…}/kick`). `/metrics` reads live paths and bitrate from the same API. MinIO was dropped: its images are no longer on Docker Hub, quay.io or Bitnami, so VOD archiving is out of scope.

**Consequences.** Key lifecycle and media enforcement share one source of truth. The scratch-based MediaMTX image has no shell, so its readiness is checked by `/health` through the API instead of a container healthcheck.

## ADR-7: Spec ambiguities resolved explicitly, so every error code is reachable

**Context.** Hidden vectors cover every catalogue error code, but some contract orderings make a code unreachable. Example: only 4 players are seeded, so any 5-participant co-stream includes an unknown id, and 404 would always beat 409 `COSTREAM_SESSION_FULL`.

**Decision.** Ambiguities are logged as decisions A1–A16 in `docs/ROADMAP.md` §1 and applied consistently. Key ones: capacity before existence for co-streams (A15); flood senders go to `muted_users` and profanity senders to `kicked_users` (A2); `flagged_count` counts profanity-flagged messages (A1); the sender rate limit applies to live chat, not the audit probe (A16); postpone uses `match_status` events (A5).

**Consequences.** Every listed code has a test that reaches it. A written organizer ruling changes only the matching decision row and its test.

## ADR-8: Guest Web Player as server-served HTML, wrapped by a thin Android shell

**Context.** The Guest Web Player must load with zero install and zero login, expose 9 exact `data-testid`s, and update the score within 500 ms (D2 6.2.2, NFR-1). The native app must open `nascon://entity|stream/{id}` within 2 s without a login screen and scan QR codes (D2 6.3). Runtime services may not use the internet.

**Decision.** Express serves one static shell for `/web/*`. The current score is rendered server-side (correct first paint), WebSocket pushes keep it live with SSE as fallback, and hls.js is served from `node_modules` (no CDN). The Android app (`mobile/`, Java, `com.nascon.live`) is a WebView shell: the intent filter matches the spec block exactly, ZXing scans QR codes, the backend URL is configurable, and the WebView is created after the first frame.

**Consequences.** One UI codebase serves Selenium, browsers and the phone. Measured: Selenium 6/6 on Chrome + Firefox, deep links cold-start in 245–490 ms on an SM-A035F, physical QR scan → `/web/clubs/club-alpha-1`. Native broadcasting and push notifications are not built (see `docs/TODO.md`).
