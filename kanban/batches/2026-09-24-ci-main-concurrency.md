# Latest main CI run owns the branch

Canonical scope: maintenance of the GitHub Actions CI workflow in `01-platform-infrastructure.md#T-05.03.01`.

Direct `main` pushes previously used each commit SHA as a concurrency group, so several full CI runs for superseded commits could execute at once. CI now groups runs by workflow and Git ref and cancels an older run when a newer commit arrives on the same branch. The newest run covers the cumulative `main` tree. Pull requests keep the same latest-head behavior, and other workflows and refs have separate groups.

This changes CI scheduling only. It does not skip checks within the surviving run. `actionlint .github/workflows/ci.yml`, `python3 kanban/scripts/build_backlog.py --check`, and `git diff --check` pass locally. GitHub acceptance and the new run status are read back after push.
