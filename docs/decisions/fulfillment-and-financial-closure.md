# Fulfillment and financial closure decisions

The owner approved these recommended decisions on 9 October 2026 for the v0.3.0 milestone. The task and release ledger remains `kanban/board.json`. This document explains the retained behavior and the conditions for revisiting it.

## Invoice creation and refunds

Electricity and saving use their existing service-specific invoice writers. Consultation and solar use transaction-owned manual invoice creation. Invoice prices, terms, origin records and audits commit with the business operation. The generic `AutoInvoiceService` name does not require replacing those writers.

Wallet refunds use the shared `postWalletCredit` routine also used by `WalletService.credit`. Workers borrow the same transaction-owned ledger routine. Cross-row database triggers enforce refund budgets. PostgreSQL does not support the specification's subquery inside a `CHECK` constraint. Keep the existing triggers, locks, reservations, idempotency keys and rollback checks.

For an ordinary paid invoice, the sum of recorded completed refunds must not exceed its cumulative refunded counter. The counter may contain preserved legacy refunds that predate the current ledger. Outstanding reservations plus the cumulative counter must not exceed paid funds. Do not treat a valid legacy residual as an accounting failure or rewrite historical money to manufacture equality.

A credit note does not create a second refund pool. A refund against its entitlement uses the paid original invoice and that invoice's existing capacity and reservation rules.

## Electricity amendments

Retain electricity-only whole-percentage limits, versioned configuration and the existing request, review and price-adjustment routes. Duration and lead-time settings govern new order quotes. Submitted orders keep their immutable snapshots. An increase request captures its limit; staff approval also checks the current limit. A later reduction or disablement can therefore prevent approval of a still-pending increase without rewriting an existing contract.

The amendment is immutable JSON tied to the original contract version. Customer consent uses fresh step-up verification and binds the amendment hash, session and signing time. Revisit PDF or signed-copy requirements if the approved contracting process changes. Do not describe this mechanism as a certificate-based digital signature.

An increase activates only after customer consent, full adjustment-invoice payment and its effective date. The optional staff payment override is deferred. Keep full-payment enforcement. Decreases use the approved price-adjustment and refund workflow rather than a negative invoice.

## Profile archival and retained records

Launch supports guarded soft archival only. It performs no physical purge and makes no retention-compliance claim. Existing business-obligation, balance, ownership, current-permission, step-up and audit guards remain required.

Financial and contractual document bytes remain permanent. Any later disposal of other records requires a separately approved policy covering retention periods, holds, authority, backups and evidence. See [profile archival](../runbooks/profile-archival.md) and [account recovery](../runbooks/account-recovery.md).

## Verification notifications

Use the reviewed `profile.verification_status` templates in Persian and English. `messageFa` and `messageEn` contain the result, reason and corrective steps. SMS mappings must reference real approved provider templates and their parameters. A mapping, fixture or connectivity test does not prove event delivery.

Test external delivery only to an owned verified staff destination. Preserve exact provider and delivery receipts without recording secrets in this document. Importing templates does not authorize historical resend or backfill. See [notification template setup](../operations/notification-template-seeding.md).

## Release and production boundaries

Deliver and verify each milestone before selecting the next. A passing batch is not a release. Staging acceptance, exact deployment and Telegram receipts are separate evidence. Production promotion still requires complete launch acceptance and the owner's explicit deployment authorization.
