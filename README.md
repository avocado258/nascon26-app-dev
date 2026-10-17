# NaSCon '26 — Multi-Sport League & Club Operations Platform

## Run
```bash
cp .env.example .env   # fill in DAY1_SALT from your venue slip
DAY1_SALT=T63D1030e4b85773 docker compose up -d --build
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

## Tests
```bash
./run_tests.sh
```