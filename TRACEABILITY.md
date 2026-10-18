# Traceability Matrix

| Req ID  | Description                          | Source file(s)              | Test(s)                          | Status |
|---------|---------------------------------------|------------------------------|-----------------------------------|--------|
| FR-1.1  | Multi-sport taxonomy, event sourcing | backend/src/sports/, backend/src/scoring/engine.js, backend/src/routes/events.js | tests/unit/engine.test.js, tests/test_day2_tier0.py | DONE (config-driven sports; append-only signed log, compensation, projection) |
| FR-1.2  | League/tournament setup              | backend/leagues/              | tests/test_leagues.py            | TODO   |
| FR-1.3  | Fixture scheduling (4 formats)       | backend/src/fixtures/, backend/src/routes/fixtures.js | tests/unit/roundRobin.test.js | PARTIAL (round_robin, single_elim; swiss, double_elim TODO) |
| FR-1.4  | Standings & tie-breaks               | backend/standings/            | tests/test_standings.py          | TODO   |
| FR-2.1  | Club profiles & tenant isolation     | backend/clubs/                | tests/test_clubs.py              | TODO   |
| FR-2.2  | Roster/transfer/loan                 | backend/roster/               | tests/test_roster.py             | TODO   |
| FR-2.3  | Merchandise store + concurrency      | backend/store/                | tests/test_checkout.py           | TODO   |
| FR-5.1  | 5-tier RBAC                          | backend/rbac/                 | tests/test_rbac.py               | TODO   |
| NFR-3   | Concurrency correctness              | backend/store/                | tests/test_checkout_concurrency.py | TODO |
| NFR-4   | Offline tolerance                    | mobile/, backend/offline/     | tests/test_offline_sync.py       | TODO   |
| NFR-5   | Security (OWASP, RBAC, rate limit)   | backend/src/security/rateLimit.js, backend/src/auth/ | tests/test_zz_followups.py::test_zz_api_rate_limit_then_recovers | PARTIAL (/api/v1 rate limit + JWT pinning; RBAC matrix TODO) |
| NFR-7   | Reproducibility                      | docker-compose.yml, backend/src/seed.js, backend/src/state/registry.js | `docker compose up -d --build`; tests/test_health.py, tests/test_day2_tier0.py | DONE (seeds on boot and reset; /health 200 in ~12 s) |


## Phase II (Day 2)

| Req ID  | Description                                   | Source file(s) | Test(s) | Status |
|---------|-----------------------------------------------|----------------|---------|--------|
| FR-3.1  | Athlete identity / follow graph               | backend/src/social/athletes.js, backend/src/routes/day2.js | tests/test_zz_followups.py | DONE (career + live/upcoming + VOD archive from event logs; idempotent, drift-free follow; guest follow → 403) |
| FR-3.2  | Solo streaming, rotating keys, overlays       | backend/src/streaming/keys.js, backend/src/routes/media.js, mediamtx.yml, backend/src/web/app.js | tests/unit/day2.test.js, tests/test_day2_tier1.py | DONE (keys + revoke/kick + MediaMTX auth; live score overlay). VOD to MinIO not built |
| FR-3.3  | 4-way co-stream, host handoff, unified chat   | backend/src/costream/engine.js, backend/src/realtime/chat.js | tests/unit/day2.test.js, tests/test_day2_tier1.py | DONE (contract, chat-{session} with monotonic seq, host-signed invite tokens via `POST /api/v1/costream/:id/invite`) |
| FR-4.1  | Dynamic QR deep-links + SVG/PNG/PDF export    | backend/src/qr/engine.js, backend/src/routes/qr.js | tests/unit/day2.test.js, tests/test_day2_tier1.py, tests/selenium/test_guest_grid.py | DONE |
| FR-4.2  | Zero-account guest experience                 | backend/src/guest/engine.js, backend/src/web/ | tests/selenium/test_guest_grid.py | DONE |
| FR-4.3  | Server-enforced read-only guest boundary      | backend/src/auth/guest.js (guardWrite on events/checkout/chat) | tests/test_day2_tier0.py, tests/test_day2_tier1.py, tests/selenium/test_guest_grid.py | DONE |
| FR-4.4  | Progressive registration + atomic cart merge  | backend/src/guest/engine.js, backend/src/auth/jwt.js, backend/src/web/app.js | tests/unit/day2.test.js, tests/test_day2_tier1.py | DONE |
| FR-5.2  | Notification bus + DLQ (3 retries)            | backend/src/notify/dlq.js, backend/src/realtime/hub.js (`/ws/notify/{user}`) | tests/unit/day2.test.js, tests/test_day2_tier1.py, tests/test_zz_followups.py | DONE (score, chat, co-stream invites; offline invitee → DLQ) |
| FR-5.3  | Chat moderation (leetspeak, flood, rate)      | backend/src/moderation/engine.js, backend/src/routes/day2.js | tests/unit/day2.test.js, tests/test_day2_tier1.py | DONE |
| NFR-1   | Score push p95 < 500 ms (25 WS clients)       | backend/src/realtime/hub.js | tests/test_day2_tier1.py::test_score_broadcast_reaches_25_ws_clients_fast, selenium test 3 | DONE |
| NFR-2   | 500 viewers + 50 chat posters, 0% 5xx         | tests/k6_load.js | k6 run (0.00% failed, p95 239 ms locally) | DONE |
| NFR-6   | Prometheus /metrics                           | backend/src/routes/day2.js (`metrics`) | tests/test_day2_tier1.py::test_metrics_exposition | DONE |
| NFR-8   | Guest Web Player WCAG 2.1 AA                  | backend/src/web/index.html, styles.css | tests/selenium/test_guest_grid.py | DONE (contrast ≥ 4.5:1, labels, 48 px targets, keyboard, focus ring) |
| NFR-9   | Privacy: no IP/UA in telemetry, erasure < 1 s | backend/src/qr/engine.js, backend/src/routes/day2.js (`privacy`) | tests/test_day2_tier1.py::test_privacy_erasure_revokes_tokens | DONE |
| QA      | Grid / Appium / CI                            | docker-compose.yml, tests/selenium/, tests/appium/, .github/workflows/autograde.yml | tests/reports/ | DONE (Appium suite skips without device) |

_Update this file every time a requirement is implemented — judges map every FR/NFR ID to code + tests off this table._