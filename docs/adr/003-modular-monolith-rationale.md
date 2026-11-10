# ADR 003 Modular monolith and service extraction

## Context

Orders, contracts, invoices, payments and authorization share transactional
invariants. The NestJS modules own their writes and expose interfaces to other
modules. The web, API and worker already run as separate processes. [System architecture](../../architecture.md).

## Decision

Keep the modular monolith while it meets the documented objectives. An
extraction needs a measured independent scaling, security, availability or
deployment requirement. Record the affected journey, the measurement window
and the limit the current topology cannot meet. [Service objectives](../operations/service-objectives.md).

## Alternatives

Compare the extraction with query or job tuning, additional capacity in the
existing topology, a dedicated worker, and a process-level isolation boundary.
Record which alternatives can meet the measured requirement and their cost.

## Consequences

The monolith preserves local transactions and simplifies coordinated rollout.
An extracted service adds a failure boundary, remote calls and an independent
deployment. Its ownership and compatibility guarantees need explicit proof.

## Owner and review trigger

Platform Engineering and the affected domain maintainers own the review.
Reopen this decision when production measurements or an approved security
boundary demonstrate that the existing deployment cannot meet a requirement.

## Extraction review before pushing to main

- Record the measurement, the alternatives tested, and the module and operational owners.
- Verify the public API, data ownership and profile isolation across the boundary.
- Prove idempotency, retry, reconciliation and audit behavior during timeouts and replay.
- Verify logs, traces, metrics and alerts in both processes, including a failure rehearsal.
- Rehearse compatibility, migration, rollback and restoration before promoting the extracted service.
- Record the source and check receipts in the release board before pushing the reviewed batch.
