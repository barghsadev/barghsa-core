# PostgreSQL failover

**Incident P0. The database operator and primary on-call own recovery.** Suspect failover when ready checks fail or the pooler reports a writer outage. Writes, sessions and durable jobs can all be affected.

1. Record the last known good commit and time. Pause new rollout work and remove unready replicas from traffic. Identify the writer and replica state through the approved database control plane. Fence the failed primary against writes before any manual promotion.
2. Follow the managed provider's configured failover procedure, or the approved cluster procedure. Verify there is exactly one writable primary and record its timeline. Escalate to isolated restore if automatic failover cannot provide a verified writer. [Database restore](database-restore.md).
3. Verify certificate and hostname validation on the direct and pooled paths from the app network. On each authenticated, protected connection, confirm the recovered writer answers `SELECT pg_is_in_recovery();` with `false`. Verify new connections and drain stale pools without restarting healthy replicas together.
4. Verify `GET /api/health/ready`, worker recovery and readback of known committed financial records. Reconcile in-flight intents before retries. Record elapsed time and any gap from independently confirmed source records, then restore traffic gradually.

Call the database operator immediately if fencing, single-writer state or transaction readback is uncertain. Preserve the original instance until its role and retention have been reviewed. Record the timeline and proof in the follow-up. [Commercial HA topology](../adr/003-hybrid-deployment.md#6-commercial-high-availability). [Incident response](../operations/incident-response.md).
