# Saving invoice detail clarity

Canonical scope: `03-core-business.md#T-03.09.04.04`.

Saving order detail now names the `PartiallyFunded` invoice state in Persian and English, including the shared staff view. Its invoice link says "View invoice" for issued and cancelled invoices. Draft invoices remain staff work and are not linked because the customer invoice endpoint does not expose drafts. The next-action banner continues to direct customers with a partially funded invoice to the remaining payment.

Validation: the customer/staff saving journey passes in all five browser projects, including partial funding, draft visibility, and cancelled invoice history. Web and i18n typechecks, changed-file ESLint and Prettier, and canonical backlog validation pass locally.
