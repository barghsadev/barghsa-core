# Schema snapshot reconciliation

The migration journal reached 0117 while the preceding generated snapshot retained unrelated definitions from 0097. Generation proposed creating six existing tables, restoring existing columns and constraints, and replacing the already generated invoice accounting column. Applying that proposal would fail or unnecessarily rebuild existing structures.

Checkpoint 0118 contains the freshly generated current schema snapshot and only `SELECT 1` as migration SQL. Earlier SQL, snapshot files and journal timestamps remain unchanged. The new journal timestamp follows 0117. Production data and structures are unaffected by this checkpoint.

The review also found one actual declaration mismatch. The reusable wallet callback CHECK still listed only terminal states, while migration 0112 and the worker use `processing`. The declaration now includes that state. No new database alteration is needed because 0112 already applies it.

Thirty-two catalog tests compare the logically changed table definitions with a fresh production-migrated PostgreSQL database. PostgreSQL itself parses expected definitions in temporary tables. Checks cover changed column types, nullability, defaults and generated expressions; declared CHECK expressions; foreign-key columns and actions; added indexes and uniqueness. They do not claim equivalence for unsupported triggers, functions or exclusions, which remain explicit migration SQL with separate tests. Existing unrelated column definitions are outside this comparison.

The combined snapshot, domain-constraint, baseline and notification-lineage run passes 42 tests. The generator guard runs in an isolated migration copy and confirms that current schema generation makes no changes. Its negative test removes an implemented column from a fixture snapshot and confirms rejection without changing that fixture. The first negative run exposed Drizzle returning exit zero after an absolute-output-path error. The guard now uses a relative output path, rejects diagnostics and requires an explicit unchanged-schema result.

`pnpm check:db-snapshot` runs the guard and its two regression tests in CI. Root typecheck and lint pass. This evidence concerns disposable databases only; deployed data inventory, backup restoration and rollout remain separate work.
