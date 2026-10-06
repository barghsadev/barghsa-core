# Barghsa agent instructions

@/Users/majid/.codex/RTK.md

Use the installed `codebase-memory` skill for structural discovery. Check index coverage and read source for gaps. Prefix shell commands with `rtk`.

## Current authority

Read [kanban/README.md](kanban/README.md), [kanban/WORKFLOW.md](kanban/WORKFLOW.md), [kanban/RELEASES.md](kanban/RELEASES.md) and the next batch in `kanban/board.json`. Run `python3 kanban/scripts/board.py check` before selecting work.

`kanban/board.json` is the only task, release and launch-status ledger. `BOARD.md` is generated. Epic files, README and architecture define requirements. Historical evidence does not dispatch work or certify a whole task merely because a batch or PR mentioned it.

The former Cursor-builder/Codex-reviewer/PR-supervisor loop is retired. Do not restart its Hermes scheduler, restore its queue or modify external runtime state. This cleanup does not authorize a scheduler restart.

## Build and review

Work in coherent batches for the next milestone. Use qualified task keys. Inspect existing code first, especially when state is `verify`. Build only demonstrated gaps. Preserve unrelated edits and the recorded unfinished consultation patch.

Review each batch and pass related tests and applicable checks. Bind acceptance to final source and actual results. Never claim unavailable checks or stopped suites passed. Preserve money, authorization, profile isolation, concurrency, idempotency, migrations, rollback and retry boundaries. Do not relax coverage floors, budgets or critical assertions.

Use conventional commits, explicitly stage reviewed paths and normally push directly to `main` using Git/GitHub CLI. Read back the exact remote SHA. Do not create PRs or force-push main. Hosted CI is independent of staging deployment. Investigate failures without redundantly rerunning every suite.

Update affected statuses, remaining criteria and evidence in the board, then regenerate the Markdown view. `done` requires complete effective acceptance and current evidence. `superseded` requires an explicit approved disposition. No second progress file or continuation diary.

## Releases

A batch is not automatically a release. Prepare SemVer/notes, deploy and announce only when a milestone and its gates are accepted. The first production launch includes electricity, saving, solar and consultation.

After exact release push verification, immediately enqueue the detached staging worker. It runs `./deploy/staging/deploy.sh` on the immutable commit, verifies health and live metadata, and posts Persian Telegram notes. Continue building without waiting for CI/deployment. Record actual staging and Telegram receipts separately from the push.

Use @barghsa_dev_bot and Barghsa Release Radar `-1004467450624`, with private secrets. Send at most one Persian summary and one grouped album per release, never one post per screenshot. Attach reviewed actual captures, respect album limits and link a gallery for extras. Never blindly retry unknown delivery. Login and Telegram display the root version.

Production requires complete launch acceptance, operational evidence and explicit owner authorization. Staging deployment permission does not authorize production.

## Project conventions

Conventional commits and strict TypeScript. User-facing strings in Persian/English dictionaries. RTL and accessibility are requirements. Audit state changes; use expand/migrate/contract for migrations. No committed secrets, debug endpoints or production console.log residue. No external messages except authorized release updates. Do not introduce agent delegation unless explicitly requested.

Do not load the entire board or historical evidence into context. Use `board.py next`, `list --release` and `show <qualified-key>` for the current scope.
