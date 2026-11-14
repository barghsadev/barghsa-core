# PostgreSQL backup alerts

Treat `PostgresBackupFailed`, `PostgresBackupStale` and `PostgresBackupMonitoringUnavailable` as P1. Use the PostgreSQL dashboard to check the last job result and the age of the last verified full backup for the affected environment and database.

1. Check the backup service and timer on the dedicated backup host. Confirm the last run, the job phase, and the private report timestamps. If the expected target is absent, check the protected service discovery file and its labels. If the target is present, check textfile permissions, exporter health and the authenticated scrape.
2. Confirm the latest usable backup and continuous WAL history in the approved off-server store. A retention failure can coexist with a newer verified full backup. Preserve the successful backup and determine why retention failed before retrying cleanup.
3. Hold production promotion when the latest verified backup is missing or at least 24 hours old. Recover the backup path and verify a fresh backup through the existing scheduled job. Retain the failure, recovery and on-call receipts.

Follow the [backup and restore procedure](../operations/backup/postgresql-restore-runbook.md) for off-server evidence, replay checks and measured recovery. [Incident response](../operations/incident-response.md).

For `PostgresDiskUsageHigh`, use the capacity panel to identify the affected filesystem and confirm the available bytes on the database host with `df -P` against the data directory. Check WAL growth, replication slots, archive delivery and recent volume growth. Hold disk-intensive cutovers while capacity is insufficient. Preserve WAL and PostgreSQL data files during recovery. Verify archive continuity and fresh capacity samples after remediation.

For `PostgresDiskMonitoringUnavailable`, verify the approved exporter, certificate and configured mount. Compare the exporter mount against the filesystem actually backing the data directory. Treat a missing series as unknown capacity and check the host directly.
