#!/usr/bin/env bash
# check-flaky-tests.sh — Report flaky test count per run
#
# This script is part of the flaky-test quarantine process.
# It scans test output for known flaky test markers and reports
# the count. Actual flaky detection logic is test-runner dependent;
# this is the placeholder that CI calls.
#
# Exit codes:
#   0 — No flaky tests detected (or detection not yet configured)
#   1 — Flaky tests detected (blocks CI only when configured)
# 255 — Missing dependency or configuration error

set -euo pipefail

echo "::notice::Flaky test check: report placeholder"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "flaky_count=0" >> "$GITHUB_OUTPUT"
echo "Total flaky tests: 0 (detection not yet configured for this runner)"
exit 0