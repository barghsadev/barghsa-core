# Database migrations

`packages/db/drizzle/production` is the deployable migration history. The older SQL files outside that directory remain historical evidence. Generate from `packages/db/drizzle.config.ts`; keep the schema snapshot and ordered journal together with each new migration. Excluding test schemas prevents fixture tables entering production. Do not rewrite a migration already applied to a database.

## Expand, migrate, contract

1. **Expand:** add compatible nullable columns, tables, indexes or constraints that allow the current and next application versions to coexist. Add new validation as `NOT VALID` when legacy data needs reconciliation. Review locking and resource costs. Run the migration runner before starting the new application version.
2. **Migrate:** move or reconcile data in resumable, bounded batches. Keep old writers compatible until the transition is complete. Record counts, rejected rows, retry behavior and verification evidence without exposing private records. Do not automatically backfill notifications, send messages or change financial history.
3. **Contract:** use a separate follow-up PR after old writers are retired and migration evidence is verified. Link tested backup/restore proof before dropping or narrowing data. Archive removed values first where retention rules require it, with access and retention controls. Validate deferred constraints only after legacy rows are reconciled.

The runner applies journal order under one advisory lock and verifies SQL checksums and complete history before and after applying Drizzle migrations. It rejects changed applied SQL, history gaps and a database newer than the checkout. Do not reorder files to group phases; compatible expansion belongs in earlier PRs and contraction belongs in a later one. Failed migration execution exits nonzero; do not start a new application version after that failure.

## Release checks

- Run the clean-baseline and upgrade-path database tests, migration-runner tests and schema snapshot comparison. CI executes these with the database test suite for each PR.
- Build and package the complete production SQL directory and journal. Use the direct database connection for migrations, bypassing transaction pooling.
- Run `pnpm --filter @barghsa/db db:migrate:run`. `EXPECTED_MIGRATION_ID` accepts the full journal tag for a post-run version check. Retain the reported applied tags and the exit status in release evidence.
- Verify application readiness and the expected schema before accepting traffic. The API checks the latest applied migration timestamp and SQL checksum against the packaged migration head within the existing five-second database probe deadline. Missing, older, newer or mismatched metadata returns not-ready. Ship SQL/journal with the API; migrate before starting it. A successful connection alone is not schema compatibility evidence.
- Roll back application images only while the schema remains compatible. Never edit applied migration hashes or assume a destructive migration can be undone by reversing a file. Use the reviewed restore procedure if data recovery is required.

These instructions define the required release sequence. They do not claim an external deployment, legacy-data reconciliation or restore exercise was performed.
