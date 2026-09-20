# Approval-time refund transactions

Branch: `codex/refund-pending-ledger`, based on merged PR #313 at `b7bc57b456c92c0094b88c17cf354df6b998f112`.

Status: merged as [PR #314](https://github.com/barghsadev/barghsa-core/pull/314) at `5fa83cc490ad299f0bce68e48e193f9877157d33`.

## Scope and behavior

Remaining approval-time pending transaction criterion for `04-invoices-wallet-contracts.md#T-04.4.01.02`. Migration 0137 creates one financial transaction when a wallet or external bank refund is approved. A unique refund link retains its identity through processing and retries. Amount, profile and destination come from the immutable refund. Approval creates no wallet credit and changes no balance.

A failed attempt leaves the transaction Pending. Wallet completion links the exact Completed ledger credit by canonical key, refund reference, profile, amount and type. Bank completion requires the existing transfer/reconciliation evidence and never links a wallet credit. Rejection and cancellation close approved transactions without moving money; requests rejected before approval have no transaction. Terminal history, transaction identity and linked credit identity cannot be rewritten or deleted.

Production triggers keep the financial transaction, refund outcome and existing invoice counter in the same database transaction. Existing API/worker audits, credit posting and notifications remain atomic with these updates. Staff API responses expose the transaction ID, state, posted credit link and timestamps. The shared wallet credit API retains its existing behavior.

The migration backfills only Approved/Processing/Failed refunds as unpaid Pending intents. Its creation timestamp records backfill time; it does not invent historical approval timestamps or credits. Historical Completed/Rejected/Cancelled and unapproved Requested records are not rewritten. The legacy-upgrade test runs the actual journal through 0136, seeds old data, applies 0137, and reruns deployment.

## Validation

- Database production-migration, refund storage and retry processing suites: 46 tests pass.
- Refund HTTP/state and wallet credit integration suites: 57 tests pass.
- Coverage includes all nine existing state-machine edges, approval without money movement, concurrent approval identity, bank reconciliation without wallet credit, approval/completion audit rollback, failed retries, exact bigint values, legacy upgrade, immutable history and mismatched credit rejection.
- API and database builds/typechecks, changed-file ESLint, snapshot guard and generated OpenAPI comparison pass.
- Changed/critical source gate against `b7bc57b4`: API refund service 93.01% lines / 90% branches; new database schema 100% executable lines. Existing coverage floors are unchanged.

## Merge evidence

[Independent review](https://github.com/barghsadev/barghsa-core/pull/314#issuecomment-5751680973) approved final HEAD `d814891d3b99d64e65aed78d7d42186dfb4f75bf` with no findings. [CI run](https://github.com/barghsadev/barghsa-core/actions/runs/35528336189) passed all five active checks; tests took 17m29s. Merge and durable review binding were read back and verified. Automatic contract obligations remain the next separate workflow. Do not change historical supervisor completion arrays or restart the paused scheduler.
