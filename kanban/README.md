# Barghsa development board

Start with [current tasks](BOARD.md), [release plan](RELEASES.md), and [working process](WORKFLOW.md).

For a sustained Codex run, use [the release goal prompt](GOAL-PROMPT.md). It defines release selection, proportional checks, independent deployment and completion boundaries.

`board.json` is the only editable source of task status, release assignments, decisions and launch readiness. `BOARD.md` is generated from it. The seven `epics/` files and the product and architecture documents retain requirements; they do not record completion. Operational runbooks remain instructions, not status trackers.

```sh
python3 kanban/scripts/board.py check
python3 kanban/scripts/board.py next
python3 kanban/scripts/board.py list --release 0.2.0
python3 kanban/scripts/board.py show '03-core-business.md#T-03.03.02.04'
python3 kanban/scripts/board.py evidence 2026-10-06-customer-consultation-history-scope
python3 kanban/scripts/board.py render
```

The first production launch includes electricity, energy saving, solar and consultation. Batches implement coherent parts of a milestone. Only accepted releases get a version, staging deployment and release announcement.

The old queue, audit execution ledgers, continuation diary and automated dispatcher are retired. Evidence was reconciled into the board and remains recoverable from Git history. See [reconciliation notes](RECONCILIATION.md). Do not restart the old scheduler or dispatch from historical completion lists.

Application changes from the former v0.1.30 batch are preserved, uncommitted and unreleased. Finish them within v0.2.0. Their validation and source hashes are recorded in the board.

Do not load the entire board or historical evidence into context. Use `board.py next`, `list --release` and `show <qualified-key>` for the current scope.
