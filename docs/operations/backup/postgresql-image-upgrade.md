# Changing the PostgreSQL runtime image

Changing the PostgreSQL operating system also changes the library used to compare and sort text. The staged Bookworm cluster uses `en_US.utf8` with a recorded GNU libc collation version; the tested Alpine image reports the same locale name without that version. Do not start Alpine against the Bookworm data directory or replay its physical WAL into an Alpine cluster.

For a staging upgrade, keep the current image and data volume intact. Rehearse on a fresh cluster first. Before the live change, stop writes, take and verify a backup, export the required database roles and grants securely, and take a logical database dump. Restore into a new volume using the intended locale. Rebuild indexes through the logical restore, confirm extension versions, compare the complete role and grant inventory, and rerun the packaged migrator to verify the migration journal. Check Unicode ordering, wallet and invoice totals, immutable ledger entries, private reads and app readiness before resuming writes.

Keep the original cluster stopped and protected until the recovery window closes. The previous volume can serve as a rollback while no new writes have been accepted. After new writes, switching back could lose data; stop traffic and use the approved recovery or roll-forward procedure. Rehearse backup and WAL recovery independently on the new operating system. See the [PostgreSQL restore runbook](postgresql-restore-runbook.md) and [PostgreSQL collation guidance](https://www.postgresql.org/docs/16/sql-altercollation.html).

The normal application release retains the active database image. The production application uses a separate PostgreSQL service; this staging image rehearsal does not authorize a production database change.
