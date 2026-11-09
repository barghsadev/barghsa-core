# PostgreSQL restore

**Incident P0. The database operator runs recovery and Finance verifies business state.** Use a restore when the writer and its failover cannot recover verified state, or when a destructive operation damaged data.

1. Record the incident time, last independently confirmed transaction, known affected data and desired recovery point. Preserve the source and its volumes. Start the recovery clock before provisioning or downloading.
2. Prepare a clone on separate storage using the approved backup key and pinned PostgreSQL image. Use a nonexistent target directory, for example `/opt/backup/restore-pg.sh --latest --target-dir /recovery/candidate`. For PITR use the documented timezone-qualified target. Start replay on a private socket and wait for completion. [Physical restore commands](../operations/backup/postgresql-restore-runbook.md#isolated-full-or-point-in-time-restore).
3. Verify the fingerprints, migration/schema state and committed financial records against an independent baseline. Require the restore procedure's integrity checks and record measured RPO and RTO. Treat missing source comparison as unknown.
4. Before approved cutover, fence source writes, configure the new archive namespace, verify direct and pooled TLS, and restore required protected configuration. Bring up API and worker, check readiness, verify committed business records and resolve unknown provider outcomes before retrying.

Call the database operator and Finance lead if replay, checksums, RPO or business verification fail. Preserve both the source and the recovered clone until review. Record evidence and corrective actions after recovery. [Config and key recovery](../operations/backup/config-restore-runbook.md). [Incident response](../operations/incident-response.md).
