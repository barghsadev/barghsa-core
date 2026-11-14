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
restore matched the Debian reference on all 187 tables and 660 text columns
in the QA-named database that serves the staging preview. The retained
`barghsa_staging` baseline matched across 186 tables and 652 text columns.
Schema, grants, extension versions and the expanded Persian and English
ordering sample matched. Include both databases in the verified cutover
backup. Verify the API and worker's direct and pooled database names before
rehearsing migrations. The PostgreSQL bootstrap database name can differ
from the one the app serves.
Run the packaged backup tools as `postgres` during image verification. The
first trial build inherited owner-only file modes from its private archive,
which prevented that user from loading the backup modules.

From the reviewed checkout, build a new staging tag and scan the resulting
image. The build uses the existing backup image for the privilege-drop binary,
its notices and the PostGIS initialization scripts. The staging builder refreshes
the signed Ubuntu package index and reruns the stages that install from it.
Compare the resulting package versions with the license review before loading
the image. CI builds and inventories both database images under separate scopes.

```bash
bash deploy/staging/build-postgres-image.sh barghsa-postgres:vps-ubuntu-rehearsal
bash scripts/check-runtime-images.sh /secure/pg-image-scan barghsa-postgres:vps-ubuntu-rehearsal
```

The packaged migrator applied `0289_solar_document_destruction_guard` once
on each restored copy of the staging preview database. A repeat invocation
reported zero pending migrations, and all 186 application-table fingerprints
matched the pre-migration snapshots. The previous app's schema readiness
passed at `0288` and rejected the database after `0289`. Rehearse rollback
with the original application images and original database volume together,
while writes are paused through cutover verification.

Keep the original cluster stopped and protected until the recovery window closes. The previous volume can serve as a rollback while no new writes have been accepted. After new writes, switching back could lose data; stop traffic and use the approved recovery or roll-forward procedure. Rehearse backup and WAL recovery independently on the new operating system. See the [PostgreSQL restore runbook](postgresql-restore-runbook.md) and [PostgreSQL collation guidance](https://www.postgresql.org/docs/16/sql-altercollation.html).

The normal application release retains the active database image. The production application uses a separate PostgreSQL service; this staging image rehearsal does not authorize a production database change.

Use a separate cutover under the staging release lock for a restored volume.
Name the new volume `barghsa-staging_pgdata-<cutover-id>` and mount it at
`/var/lib/postgresql/data`. Preserve the previous active manifest and verify the
replacement image and volume on the stopped-writes topology before updating
`/etc/barghsa/staging/active-images.env`. Record the paired
`BARGHSA_POSTGRES_IMAGE` and `BARGHSA_POSTGRES_VOLUME` values together. The
ordinary release rejects a different volume and checks the mounted volume
before any migrations. For a pre-write rollback, use the preserved manifest
with its original image and volume.

## Size the staging cutover

On November 14 at 02:36 UTC, Docker's data directory, the active
`barghsa-staging_pgdata` volume and `/tmp` shared one filesystem with
6,257,455,104 bytes available at 93% utilization. The volume contained
107,408,958 apparent bytes, including 33,554,432 bytes of WAL, and had no
external tablespace links. Use these numbers to plan the first rehearsal and
repeat the measurements before the cutover.

- Measure free bytes and verify the mount for the Docker data directory,
  backup scratch, image archive and restore target. Count space on a shared
  filesystem once. Inventory the active data directory and any external
  tablespaces. Keep the previous database volume and rollback images in place.
- Budget backup scratch for the native tar files, extracted payload, plaintext
  archive and encrypted archive. They coexist before upload. Independently
  budget the restore filesystem for the downloaded ciphertext, decrypted
  archive, extracted payload and WAL replay. Use measured file sizes and peak
  usage from the isolated exercise. Add the logical dump, restored database,
  replacement and candidate image layers, transfer archive and room for growth
  during the maintenance window where they share the filesystem.
- On the approved HTTPS backup destination, verify quota for retained full
  backups, WAL, retained object versions and the next upload. Restore from the
  verified off-server copy with the recoverable key and compare both staging
  databases before starting the live cutover.
