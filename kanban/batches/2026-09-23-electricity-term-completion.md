# Electricity term completion

Canonical scope: `03-core-business.md#T-03.07.01.01` (the `active` to `completed` transition).

Contract term completion now changes the linked electricity order and electricity-contract statuses to `completed` in the same database transaction. An inconsistent linked status prevents completion and leaves the evidence, contract, and order unchanged for retry after repair. The migration reconciles active electricity rows linked to contracts that were already completed, with an audit entry for each corrected order. Financial records remain independent and are not modified.

Validation: eleven migrated PostgreSQL completion tests cover successful linked completion, unchanged paid invoice, rollback on inconsistent or missing links, retry, and reconciliation when upgrading from migration 0170. The production migration chain, build, typecheck, lint, schema snapshot, formatting, and backlog checks passed. The wider database suite still has 12 failures in existing legacy-upgrade, seed, and timestamp-trigger expectations; those files and their failing migrations predate this batch.
