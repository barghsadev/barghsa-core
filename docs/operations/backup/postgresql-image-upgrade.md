# Changing the PostgreSQL runtime image

Changing the PostgreSQL operating system also changes the library used to compare and sort text. The staged Bookworm cluster uses `en_US.utf8` with a recorded GNU libc collation version; the tested Alpine image reports the same locale name without that version. Do not start Alpine against the Bookworm data directory or replay its physical WAL into an Alpine cluster.

The staging comparison found that the Alpine default sorts `Alpha` before
`alpha`, while the current Bookworm database sorts `alpha` first. Both tested
Alpine ICU collations also reverse the Bookworm order of `برق‌سبز` and `برق سبز`.
Include mixed case, accents, Persian digits, and the Persian half-space in the
ordering and search checks for the application queries that use the database
default. Verify those results before switching the active database.

For a staging upgrade, keep the current image and data volume intact. Rehearse on a fresh cluster first. Before the live change, stop writes, take and verify a backup, export the required database roles and grants securely, and take a logical database dump. Restore into a new volume using the intended locale. Rebuild indexes through the logical restore, confirm extension versions, compare the complete role and grant inventory, and rerun the packaged migrator to verify the migration journal. Check Unicode ordering, wallet and invoice totals, immutable ledger entries, private reads and app readiness before resuming writes.

The v0.6.0 rehearsal restored one staging snapshot into separate Debian and
Alpine containers. All 186 table fingerprints, schema, grants, roles, sequences
and extension versions matched, with zero invalid indexes. The Alpine image
passed the vulnerability scan. The ordering mismatch kept it from replacing
the running staging database. A scan of the upstream PostgreSQL 16.15 Bookworm
image also failed the high and critical vulnerability gate.

The Ubuntu 24.04 trial used PostgreSQL 16.15, PostGIS 3.6.4, and pgvector
0.8.6. Its exact image had zero high or critical findings. The isolated
restore matched the Debian reference on all 186 application tables, schema,
grants, and extension versions. It also matched ordering and case conversion
in 652 text columns and the expanded Persian and English sample. The same
rehearsal restored the retained QA database and matched its 187 tables and
660 text columns. Include both databases in the verified cutover backup.
Run the packaged backup tools as `postgres` during image verification. The
first trial build inherited owner-only file modes from its private archive,
which prevented that user from loading the backup modules.

Keep the original cluster stopped and protected until the recovery window closes. The previous volume can serve as a rollback while no new writes have been accepted. After new writes, switching back could lose data; stop traffic and use the approved recovery or roll-forward procedure. Rehearse backup and WAL recovery independently on the new operating system. See the [PostgreSQL restore runbook](postgresql-restore-runbook.md) and [PostgreSQL collation guidance](https://www.postgresql.org/docs/16/sql-altercollation.html).

The normal application release retains the active database image. The production application uses a separate PostgreSQL service; this staging image rehearsal does not authorize a production database change.
