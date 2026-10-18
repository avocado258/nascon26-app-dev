# Pending tasks (cross-check of Day 1 + Day 2 specs, 2026-10-18 13:42 PKT)

Method: every endpoint in D1 §5.1 and D2 §5.1 was probed live on the running stack; every FR/NFR ID was checked against code, tests and `TRACEABILITY.md`.

## Scoreboard

| Spec | Endpoints live | Notes |
|---|---|---|
| Day 2 (graded now) | 13 / 13 | Contract tests 160/160, Selenium 6/6, k6 pass, CI green |
| Day 1 (score locked) | 6 / 16 | `/health`, `/reset`, `/sports`, `/fixtures` (RR + SE only), `/events`, `/score` |

## A. Before final push (14:05 hard lock; 14:20 only if confirmed in writing)

1. **Write `ADR.md` at repo root: 8 short ADRs** (rules booklet §4.5: defended in the Top-8 viva at 14:30). Candidates: in-memory stores reset by `seedBaseline()`; event-sourced match log; canonical-JSON HMAC signing with env salts; guest boundary enforced server-side before validation; synchronous single-thread atomicity for cart merge / moderation (edge cases 3–4); MediaMTX + HTTP auth hook for key revocation; co-stream capacity checked before existence (A15); WebView shell app for deep links. ~15 min.
2. Regenerate `tests/reports/*` on the final commit (contract, Selenium, Appium, k6) and commit. ~5 min.
3. Final push before 14:05 and confirm the Actions run is green. ~3 min.

## B. Before the viva (14:30) — prepare, not code

1. Start Appium for the desk check: `appium` (v3.8.0 installed) on :4723 with the `uiautomator2` driver (`appium driver install uiautomator2` if missing), phone on USB, then `pytest tests/appium/`.
2. Rehearse the 4 hidden scenarios live: host drop (`simulate_host_drop`), QR target change after `match_end`/postpone, 10 concurrent moderation probes, cart-merge replay.
3. Know the ambiguity decisions A1–A16 (`docs/ROADMAP.md` §1) — likely viva questions.

## C. Day 2 requirements not fully met

| ID | Gap | Size |
|---|---|---|
| FR-3.1 | Athlete profile lacks career records, upcoming fixtures, VOD archive; follow/unfollow with concurrency-safe counts not built | M |
| FR-3.2 | VOD recording to object storage not built (MinIO dropped); revoke-severs-ingest < 2 s and glass-to-glass < 3 s never tested with a real RTMP publish (no ffmpeg on this laptop) | M |
| FR-3.3 | No real composite mixing (URL only); host controls (signed invite tokens, mute/spotlight/kick) not built; handoff only via `simulate_host_drop`, not on WebSocket disconnect | L |
| FR-5.2 | Realtime bus carries score + chat only; co-stream invite and order-status notifications not dispatched | S |
| Mobile (20% pool) | App is a WebView shell: no native solo broadcaster (WHIP/RTMP), no 4-way split-view UI, no push notifications | L |
| QA | Appium suite never run against a live Appium server (skips in CI); cross-surface test unproven | S |
| NFR-8 | WCAG checked by design + Selenium DOM checks only; no automated contrast/axe audit | S |

## D. Day 1 gaps (Phase I score is locked; matters for viva and Phase I regression only)

| Area | Missing | Endpoint(s) |
|---|---|---|
| FR-1.3 | Swiss pairing, double elimination; rescheduling conflict detection; match state broadcast | `/fixtures` swiss, double_elim |
| FR-1.2 / FR-1.4 | League registration, standings with tie-breaks, h2h, NRR, clinched/eliminated | `/leagues`, `/standings/{id}` |
| FR-2.2 | Roster setup, transfer/loan/release rules, audit history + loan auto-return | `/roster/setup`, `/roster/transfer`, `/roster/history/{id}` |
| FR-2.3 / NFR-3 | Real checkout (stock reservation, mock gateway, signed PDF receipt), inventory | `/checkout` (501 stub), `/inventory/{id}` |
| FR-5.1 / NFR-5 | RBAC JWT matrix + 7 probe routes; `/api/v1/*` rate limit (100 / 10 s, 429 + Retry-After) | `/rbac-matrix`, `/rbac/*`, `/api/v1/ping` |
| NFR-4 | Offline sync replay + conflict resolution; mobile offline queue | `/offline-sync` |
| FR-2.1 | Club portal (venue, socials, staff, white-label tenant branding) | — |
| Small | `tie_break_order` repeats not rejected (`sports/validate.js`); `COVERAGE.json` Day 1 areas all 0.0 | — |
