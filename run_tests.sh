#!/usr/bin/env bash
# Unit tests with line coverage (no server needed), then black-box API tests against http://localhost:8080.
# Selenium (tests/selenium) needs the grid on :4444; Appium (tests/appium) skips unless :4723 is up.
set -euo pipefail
cd "$(dirname "$0")"
# Unit tests load backend modules directly; install them on a fresh checkout.
[ -d backend/node_modules ] || npm ci --prefix backend
node --test --experimental-test-coverage tests/unit/*.test.js
pytest tests/ --ignore=tests/selenium --ignore=tests/appium
