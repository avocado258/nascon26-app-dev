# NaSCon '26 — Multi-Sport League & Club Operations Platform

## Run
```bash
cp .env.example .env   # fill in DAY1_SALT / DAY2_SALT from your venue slips
DAY1_SALT=<day1-salt> DAY2_SALT=<day2-salt> docker compose up -d --build
curl http://localhost:8080/health
```

## Demo Accounts (seeded on every /audit/v1/reset)
| Role              | Email                  | Password   |
|-------------------|-------------------------|------------|
| Platform Super-Admin | admin@nascon.test     | Nascon@26  |
| League Organizer  | organizer@nascon.test   | Nascon@26  |
| Club Manager      | manager@nascon.test     | Nascon@26  |
| Player            | player@nascon.test      | Nascon@26  |
| General Viewer    | viewer@nascon.test      | Nascon@26  |

## Mobile
See `mobile/README.md`. APK at `mobile/release/app-release.apk`.
Set backend host in app settings (emulator: `10.0.2.2:8080`, device: laptop LAN IP).

## Day 2 surfaces
| URL | What |
|---|---|
| http://localhost:8080/q/m1-live | Dynamic QR short link → Guest Web Player |
| http://localhost:8080/web/matches/match-m1/live | Guest Web Player (no login; sign in only to chat/checkout) |
| http://localhost:8080/metrics | Prometheus metrics |
| rtmp://localhost:1935/live/{stream_key} | RTMP ingest (key from `POST /audit/v1/stream/key`) |
| http://localhost:8888/live/{stream_key}/index.m3u8 | HLS playback |
| http://localhost:4444/status | Selenium Grid 4 (hub + 3 nodes) |

## Tests
```bash
./run_tests.sh                                                     # unit (+coverage) and API contract tests
pytest -n 3 tests/selenium/ --junitxml=tests/reports/selenium-report.xml
pytest tests/appium/ --junitxml=tests/reports/appium-report.xml   # needs Appium 2 on :4723 + device
docker run --rm --network host -v "$PWD/tests:/tests" grafana/k6:0.54.0 run --summary-export=/tests/reports/k6-summary.json /tests/k6_load.js
```