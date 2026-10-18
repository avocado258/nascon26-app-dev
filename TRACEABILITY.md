# Traceability Matrix

| Req ID  | Description                          | Source file(s)              | Test(s)                          | Status |
|---------|---------------------------------------|------------------------------|-----------------------------------|--------|
| FR-1.1  | Multi-sport taxonomy, event sourcing | backend/src/sports/, backend/src/routes/sports.js | tests/test_sports.py | PARTIAL (sport config done; event sourcing TODO) |
| FR-1.2  | League/tournament setup              | backend/leagues/              | tests/test_leagues.py            | TODO   |
| FR-1.3  | Fixture scheduling (4 formats)       | backend/src/fixtures/, backend/src/routes/fixtures.js | tests/unit/roundRobin.test.js | PARTIAL (round_robin, single_elim; swiss, double_elim TODO) |
| FR-1.4  | Standings & tie-breaks               | backend/standings/            | tests/test_standings.py          | TODO   |
| FR-2.1  | Club profiles & tenant isolation     | backend/clubs/                | tests/test_clubs.py              | TODO   |
| FR-2.2  | Roster/transfer/loan                 | backend/roster/               | tests/test_roster.py             | TODO   |
| FR-2.3  | Merchandise store + concurrency      | backend/store/                | tests/test_checkout.py           | TODO   |
| FR-5.1  | 5-tier RBAC                          | backend/rbac/                 | tests/test_rbac.py               | TODO   |
| NFR-3   | Concurrency correctness              | backend/store/                | tests/test_checkout_concurrency.py | TODO |
| NFR-4   | Offline tolerance                    | mobile/, backend/offline/     | tests/test_offline_sync.py       | TODO   |
| NFR-5   | Security (OWASP, RBAC, rate limit)   | backend/security/             | tests/test_security.py           | TODO   |
| NFR-7   | Reproducibility                      | docker-compose.yml, backend/src/seed.js | manual: `docker compose up -d --build`; tests/test_health.py | PARTIAL (boots + seeds sports; DB baseline TODO) |

_Update this file every time a requirement is implemented — judges map every FR/NFR ID to code + tests off this table._