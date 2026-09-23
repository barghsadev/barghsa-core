# Consultation refund recovery batch

Canonical scope: recovery of the paid consultation adjustment and closure paths in `03-core-business.md#T-03.03.03.07` and `03-core-business.md#T-03.03.01.02`.

If a consultation refund is rejected or cancelled after a credit note was issued, staff can request the uncovered amount again. The service compares credit notes and refund requests linked by the consultation's durable financial audit records, allocates only the uncovered amount across available paid invoices, and creates new wallet refund requests in one transaction. Unrelated refunds on the same invoice do not hide a missing consultation refund. It never issues another credit note. The action works after a consultation is closed, requires financial permission and fresh step-up, and is idempotent. The staff detail shows the uncovered amount and the recovery action.

Further fee changes or closure remain blocked while an issued credit is uncovered; recovery clears that block. Refund approval and payout still run through the existing finance workflow.

Validation: HTTP integration rejects a refund through the real wallet-refund endpoint, verifies the uncovered amount, requests a replacement, verifies idempotency and that the credit-note count is unchanged, and confirms the uncovered amount returns to zero. Focused consultation suites pass 7/7 tests. Root build, typecheck, lint, formatting, backlog, and OpenAPI checks pass.
