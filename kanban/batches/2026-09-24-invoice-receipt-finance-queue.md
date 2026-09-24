# Invoice bank-receipt finance queue

Canonical scope: staff side of `04-invoices-wallet-contracts.md#S-04.3.01` and partial `07-ui-ux-design.md#T-07.18.03.03`.

Finance staff can open the invoice receipt queue from the admin invoice page, inspect a fresh receipt and its attachment, and review the invoice allocation and excess wallet credit before confirming. Confirmation uses the existing step-up dialog and backend decision API. Rejection requires a customer-visible reason. Receipts parked for dual approval point to the existing approval queue, and stale allocation previews block confirmation. The panel handles no access, loading, empty, and failed reads without showing stale receipt data.

Validation: bilingual UI tests cover the queue, allocation, confirm/reject actions, dual-approval handoff, and access denial. Existing PostgreSQL suites verify confirm/reject settlement and dual approval. Workspace build, typecheck, lint, formatting, OpenAPI, and backlog checks run before push; GitHub CI runs on the pushed commit.

Remaining: this queue covers pending receipts; a searchable historical receipt list and bank-name metadata are separate work.
