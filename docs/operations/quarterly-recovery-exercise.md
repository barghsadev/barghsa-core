# Quarterly recovery exercise

Operations coordinates the quarterly exercise with the database operator,
Security and Finance. GitHub Actions runs the hosted fixtures on the default
branch at 04:17 UTC on January 1, April 1, July 1 and October 1. Use that run
when it matches the approved review revision. For a different revision,
dispatch the workflow from the approved review ref.

```sh
gh workflow run storage-recovery-quarterly.yml --ref "$REVIEW_REF"
gh run view "$REVIEW_RUN_ID" --json headSha,event,status,conclusion,jobs
gh run download "$REVIEW_RUN_ID" --dir "$REVIEW_EVIDENCE_DIR"
shasum -a 256 -c "$REVIEW_EVIDENCE_DIR/quarterly-operator-review/review-sources.sha256"
```

For a scheduled run, omit the dispatch command and use the scheduled run ID.
Confirm the run's full commit SHA matches the approved revision. Check the
event, attempt and all three fixture outcomes in
`quarterly-operator-review/outcomes.json` against GitHub Actions. Run the
checksum command from a checkout of that revision. Retain the packet even
when a job fails, and resolve failed or skipped fixture checks before review.

## Recovery and review

1. Use the [PostgreSQL restore procedure](backup/postgresql-restore-runbook.md)
   with a fresh independently captured baseline and the approved off-server
   backup. Retain the verified table fingerprints, WAL replay point and measured
   database RPO and RTO. Exercise the configured failure handoff using an
   authorized drill recipient.
2. Restore the sealed configuration and the required object versions into the
   approved isolated environment. Start the separate application from that
   restored state. Verify readiness, login, the owned dashboard and wallet, and
   the electricity, saving, solar and consultation journeys using the dedicated
   fixture account. Record elapsed recovery time through readiness of the core
   journeys. Retain the [configuration recovery](backup/config-restore-runbook.md)
   and [object recovery](../runbooks/storage-outage.md) evidence with the database
   receipt.
3. Run the [restricted access inventory](quarterly-access-review.md) on the
   authorized review connection. Reconcile staff grants, service identities and
   masked credential references with their current owners. Review changed trust
   boundaries against the [threat model](../threat-model.md), record any required
   changes, and assign the follow-up owners and dates.
4. Exercise the [incident response procedure](incident-response.md) and
   [rollout rollback](../runbooks/bad-deployment.md) on a fixture. Use a
   reconciliation mismatch or failed readiness signal. Record detection time,
   assigned severity, acknowledgement, the halt decision, and proof that traffic
   and health returned to the known compatible release. Check the contact and
   dashboard references with the designated responders.

Record the target, reviewed source SHA, operator decisions, measured RPO and RTO,
receipt references and unresolved follow-up in the existing operations evidence.
The hosted run covers synthetic PostgreSQL and object recovery, access inventory
validation, and fixture incident controls. Live recovery measurements and human
review decisions require their own receipts.
