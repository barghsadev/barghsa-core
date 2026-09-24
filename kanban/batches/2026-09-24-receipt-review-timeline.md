# Bank receipt review timeline

Canonical scope: verification timeline in `07-ui-ux-design.md#T-07.18.03.03`, supporting the invoice bank-receipt journey in `04-invoices-wallet-contracts.md#S-04.3.01`.

The database records a receipt's Submitted, UnderReview, Confirmed and Rejected transitions in the same transaction as each state change. The customer invoice detail returns only events for the viewed invoice and active profile; staff receipt detail returns the selected receipt's events. Both interfaces show the ordered timeline in Persian and English without exposing staff IDs or audit metadata. Repeated writes of the same state create no duplicate event, and a rolled-back decision leaves no event.

Migration 0190 recovers submission and current-state markers for older receipts. It marks those events as historical; the UI explains that a recovered review or rejection time may be approximate. Existing bank-name metadata is already present. A separate cross-invoice customer receipt list is still outside this batch.

Validation: isolated PostgreSQL migration tests cover backfill, new transitions, idempotent same-state writes and rollback. Customer and staff PostgreSQL tests cover scoped timeline responses. Bilingual web tests cover both views. Workspace build, typecheck, lint, formatting, schema snapshot, OpenAPI contract and backlog checks pass before pushing to `main`.
