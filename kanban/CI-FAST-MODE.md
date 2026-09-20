# Temporary pull-request CI mode

Enabled on 2026-09-20 at the project owner's request to reduce batch turnaround.

Pull requests run affected workspace tests without coverage instrumentation. They retain builds, types, formatting, lint, contract and database snapshot checks, queue/protocol checks, dependency scanning, static security analysis, and secret scanning.

The full production browser suite and coverage collection/enforcement are temporarily disabled for pull requests. The existing combined coverage check reports this exemption explicitly and still fails if tests or integrity checks fail. Its green result in fast mode does not mean coverage was measured. Do not use it as coverage evidence in a handoff.

Pushes to main retain full tests, browser checks, and coverage enforcement. Nightly browser checks remain unchanged. New pushes cancel obsolete CI runs for the same pull request.

Restore full PR checks with `gh variable set CI_FULL_PR_CHECKS --body true`, then rerun CI. Delete the variable or set it to false to return to temporary mode. Remove the FULL_CI conditions and this document when the temporary exception ends.

Tradeoff: PRs no longer block on browser regressions or coverage thresholds; those are detected by the full main-branch run. Keep task-specific browser validation for changed user flows before merging.
