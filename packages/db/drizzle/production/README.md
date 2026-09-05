# Production migrations

Run `pnpm --filter @barghsa/db db:migrate` from source or `node packages/db/dist/migrate.js` in the runtime image. Set `PGDIRECT_URL` for a direct PostgreSQL connection. Use `EXPECTED_MIGRATION_ID=0082` to require the complete baseline and its constraints.

The older SQL and journal in the parent directory are retained as historical evidence and fixtures. They were incomplete as an installation chain. In particular, migration 0014 drops products with CASCADE. Do not replay that directory against a populated database.

The production journal starts with an additive baseline, followed by domain and foundation constraints. Existing `drizzle.__drizzle_migrations` rows remain intact. The new entries sort after the previous head, 0079. Fresh databases use the same path as upgrades.

- 0080 creates declared tables and adds missing columns. It corrects text references to UUID keys using explicit casts. Existing rows are retained; invalid IDs or missing required values fail the transaction and require a reviewed backfill.
- 0081 restores domain constraints, indexes, triggers, provider tables and catalogue protections. It keeps the final invoice uniqueness rule without replaying intermediate rules or deleting duplicate reminders.
- 0082 restores foundation constraints, reference data and indexes that previously existed only in source helpers.
- 0083 separates staff membership from platform administrator authority. Existing administrator flags are preserved for account review.
- 0084 gives unchanged predefined CRM, Finance and Legal roles the concrete capabilities used by their domain endpoints. Customized permission sets remain unchanged for review.
- 0085 binds OTP challenges to an operation and, for existing-account actions, a user. Old unscoped codes are retained but invalidated; users must request a new code after rollout.

The runner holds a direct connection and an advisory lock throughout migration. Drizzle applies pending entries transactionally. A failure prevents successful version reporting. Repeating the command applies no additional entries.

Schema generation uses the TypeScript loader and excludes test files. The retained snapshot describes the declared schema; supplemental SQL-only constraints and tables require manual migration review. Run `pnpm --filter @barghsa/db db:generate` after changing a declaration, and inspect the SQL before committing.

Every journal timestamp must exceed the previous entry. The runner rejects unordered timestamps, altered applied SQL, missing migrations behind the database head, and a database newer than the checkout before attempting migration. It verifies every journal entry after applying pending SQL. The inherited journal contains future timestamps, so a freshly generated wall-clock timestamp may need adjustment before it can be applied as an upgrade.

The baseline integration test creates an empty PostgreSQL database, migrates and seeds it twice, checks selected foreign keys and financial constraints, then upgrades a populated fixture with the old journal and missing schema. It checks product preservation, an exact balance above Number.MAX_SAFE_INTEGER and unchanged old migration records. This fixture is not a certification of every historical deployment shape. Test a restored production copy before rollout; incompatible legacy rows must be backfilled without fabricating identities or dropping business records.
