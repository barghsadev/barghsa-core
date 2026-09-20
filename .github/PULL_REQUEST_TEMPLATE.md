## What

Describe the problem and resulting behavior.

## Acceptance criteria

- [ ] Required behavior verified; list any unmet criterion and its reason.

## Validation

List the exact checks run and their results. Identify unavailable checks.

## Database changes

- Phase: none / expand / migrate / contract. Explain the phase for each schema or data change.
- Compatibility: explain how current and previous application versions behave during rollout.
- Data migration: explain batching, retries, validation and completion evidence where applicable.
- Destructive changes: link verified backup/restore proof and the earlier expansion/data-migration PR. Put the contract phase in a separate follow-up PR after old writers are retired and data migration is verified.
- Archive data before removal where retention rules require it; state the archive location and access/retention controls without including private data or secrets.

Follow [the migration procedure](../docs/development/database-migrations.md).

## Risks / limitations

Known limits, operational prerequisites and rollback steps, or None.
