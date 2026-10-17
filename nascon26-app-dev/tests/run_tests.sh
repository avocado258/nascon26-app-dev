#!/usr/bin/env bash
set -euo pipefail
pytest --cov=backend --cov-report=json:COVERAGE.json tests/