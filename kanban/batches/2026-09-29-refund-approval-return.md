# Refund approval return

Canonical scope: staff refund workflow under `04-invoices-wallet-contracts.md#T-04.4.01.05` and `04-invoices-wallet-contracts.md#T-04.4.01.06`.

An approval request tied to a wallet or external-bank refund now links back to that invoice's refund workspace and the matching destination panel. The link is shown for a valid persisted invoice ID before and after the second-review decision, so staff can continue approval, bank-reference or reconciliation steps from the same invoice. Unknown or invalid IDs do not produce a navigation link.

Validation: approval-queue Chromium journeys, web typecheck, i18n tests, changed-file lint and formatting, production build and route budgets.
