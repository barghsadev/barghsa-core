# Saving staff decision financial review

Canonical work: `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` (saving staff approval and rejection portion). Other cross-command review actions remain partial.

Staff approval and rejection now preview the locked saving order, accepted agreement, saved plan and equipment prices, installation address, current contract version, invoice balances, and the exact publication, unpaid-invoice cancellation, or wallet-refund outcome. The decision recomputes this snapshot under its mutation locks and requires the same hash. A changed invoice or contract rejects stale confirmation. The confirmed hash and full snapshot are kept in the decision audit; an idempotent replay retains the original result.

The bilingual staff confirmation shows those values and the saved agreement before step-up and submission. Switching orders invalidates an in-flight preview. The API rejects a rejection preview without a reason.

Focused validation: the saving order HTTP suite covers missing hash, stale invoice state, paid refund amount, audit persistence and replay. The staff page test covers preview-to-confirmation submission, and the Chromium saving journey covers the displayed outcome and hash. API/web typechecks and builds, shared exports, i18n build, OpenAPI, route budgets, root lint and formatting, and the backlog validator are batch checks.
