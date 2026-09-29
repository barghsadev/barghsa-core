# Refund request financial snapshot

Canonical scope: the manual wallet and external-bank refund portions of `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04`. The wider cross-command review work remains partial.

Both finance refund forms now load an authoritative invoice and refund preview before confirmation. The preview contains the issued invoice facts, line prices, tax, linked contract implications, current paid/refunded/reserved balance, resulting balance and second-approval rule. The request API requires the exact review hash; a changed balance or rule rejects the command, and the committed review is saved in the refund audit record. Replaying the same idempotency key verifies that saved review. Internal consultation refunds continue to use their existing transactional path.

Validation: wallet and external refund HTTP suites (34 tests), consultation and snapshot suites (25 tests), four bilingual Chromium refund journeys, shared/API/web typechecks, 53 i18n tests, changed-file lint and formatting, generated OpenAPI contract, production web build, route budgets and canonical backlog validation.
