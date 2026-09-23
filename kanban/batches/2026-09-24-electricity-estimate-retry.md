# Electricity estimate recovery and disclosure

Canonical scope: the estimate and manual-entry experience in `03-core-business.md#T-03.05.01.06`–`.07`.

The simple electricity order form now distinguishes a bill-data lookup in progress from an unavailable estimate. When unavailable, customers can retry without losing a manually entered quantity or changing the selected period. A successful estimate displays a readable bill-data source, dates in the selected language and Iran timezone, coverage, and an explicit reminder that the quantity is editable. Manual entry remains available throughout.

Validation: the focused order-form suite passes 7 tests, including retry after failure with a preserved manual quantity. The bilingual dictionary suite passes 53 tests. Web typecheck and production build, changed-file lint and formatting, and backlog validation pass.
