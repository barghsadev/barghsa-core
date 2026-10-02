# Onboarding timestamp repair, October 2, 2026

Exact onboarding CI [37011178296](https://github.com/barghsadev/barghsa-core/actions/runs/37011178296) failed the database-wide trigger invariant: `profile_onboarding_journeys` lacked the standard timestamp trigger. It had978 passing database cases and one failure; security, secrets and integrity succeeded. The dependent coverage-exemption job failed because tests failed.

Migration `0241_onboarding_journey_timestamps` adds `public.modify_updated_at()` before journey updates. Released migration0240 and existing records remain unchanged. The custom Drizzle migration includes the generated snapshot and a strictly increasing journal timestamp.

The populated upgrade regression starts at240 with an existing draft journey, checks unchanged rows and historical checksums after upgrade, verifies idempotent reapplication, then checks raw completion timestamps and explicit writer timestamps. The existing database-wide trigger test remains unchanged.

Validation before publication:

- `pnpm --filter @barghsa/db test src/database-foundations.integration.test.ts src/onboarding-journey-timestamps-upgrade.migrated.test.ts src/onboarding-journeys-upgrade.migrated.test.ts`: seven passing cases.
- Full database suite: 122 files and980 cases pass.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:suppressed-errors`, `pnpm check:db-snapshot`: pass.
- `pnpm check:contract`, all69 unchanged bundle budgets, backlog validation and `git diff --check`: pass.

Direct main publication follows the user's manual batch workflow. No CI gates, scheduler, supervisor state or generated task history are changed. Deploy migration0241 after0240. Exact-commit CI is read back after publication; the prior failed run is not green.

Published as `99174275fffbc63216b4e3dbf57d98560f3877a6`, verified on GitHub main. All five exact-commit CI jobs pass in [run37014404086](https://github.com/barghsadev/barghsa-core/actions/runs/37014404086).
