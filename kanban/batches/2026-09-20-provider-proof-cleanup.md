# Provider delivery proof migration cleanup

Branch: `codex/provider-proof-cleanup`.

Status: implemented and locally validated; independent review and CI pending.

## Problem and change

The full main run after PR #316 failed only during the provider delivery proof migration suite teardown. All 830 database test assertions passed, but dropping both migrated databases exceeded Vitest's default 10-second hook timeout. Evidence: [run 35532300421](https://github.com/barghsadev/barghsa-core/actions/runs/35532300421).

Give this specific cleanup hook a 30-second limit, consistent with the suite's migration-test limit and existing database fixture budgets. The test pools are already closed before cleanup. Keep both database drops and management-pool cleanup awaited; retain all assertions and error propagation. No production code, test selection, global timeouts or coverage thresholds change.

## Validation

- `pnpm --filter @barghsa/db exec vitest run src/migrate.provider-delivery-proof.test.ts src/migrate.notification-template-lineage.test.ts`: 6 tests pass.
- `pnpm --filter @barghsa/db test:coverage`: all 837 tests across 100 files pass. Coverage: 91.52% lines and 80.45% branches; existing package gates pass.
- Changed-file ESLint/Prettier and backlog validation pass.
- Independent approval and all active GitHub checks are required before merge. A subsequent full main run must verify the repair under shared CI load; local success does not prove the intermittent timeout cannot recur.

This repair completes no additional product task. Continue the E-05 document lifecycle dependency for contract signatures after merge. Scheduler and historical supervisor state remain unchanged.
