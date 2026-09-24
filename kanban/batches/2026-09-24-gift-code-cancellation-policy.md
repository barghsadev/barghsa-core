# Gift-code cancellation policy

Canonical scope: `03-core-business.md#T-03.02.01.01`, `03-core-business.md#T-03.02.01.03`, and `03-core-business.md#T-03.02.04.01`–`03-core-business.md#T-03.02.04.03`.

Gift codes now carry separate restoration settings for unpaid and paid cancellations. Unpaid cancellation restores a consumed usage slot by default; paid cancellation restores it only when an admin explicitly opts in. Admins can edit both settings in the gift-code form. Restoration records `restored_at`, keeps the redemption ledger row, and runs in the same transaction as the order or contract cancellation. Repeating a cancellation leaves the original restoration timestamp and count unchanged. Editing an unpaid electricity order releases its old redemption for replacement regardless of cancellation policy.

The migration gives existing codes the prior unpaid behavior and disables paid restoration by default. It backfills `restored_at` on previously released ledger rows. Existing code redemptions and active usage counts are unchanged.

Validation: database-backed HTTP tests cover admin policy writes, unpaid cancellation with both policy values, paid contract cancellation with both policy values, retry idempotency, and gift-code replacement during repricing. Build, typecheck, lint, schema snapshot, OpenAPI contract, and backlog checks pass before pushing to `main`.
