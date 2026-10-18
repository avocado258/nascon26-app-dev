#!/usr/bin/env bash
# Unit tests (no server needed), then black-box API tests against http://localhost:8080.
set -euo pipefail
cd "$(dirname "$0")"
node --test tests/unit/*.test.js
pytest tests/
