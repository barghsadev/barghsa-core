#!/usr/bin/env bash
# Validate and report known quarantined tests; runtime flake detection is separate.
set -euo pipefail
exec python3 "$(dirname "$0")/check-flaky-tests.py" "$@"
