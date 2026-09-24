# Customer bank receipt detail and attachment

Canonical scope: partial progress on `07-ui-ux-design.md#T-07.18.03.02` and `07-ui-ux-design.md#T-07.18.03.03`, the invoice and bank-receipt detail patterns.

The invoice payment timeline now shows each bank receipt's ID, submission and confirmation times, review state, transfer metadata, and rejection reason. Customers can reopen the submitted attachment through a short-lived signed download. The new route checks the live session, active profile, visible invoice, and receipt ownership before signing; it exposes no storage key, disables redirect caching and referrers, and returns an unavailable response if storage cannot serve the file. The receipt list remains scoped to the viewed invoice, including corrected invoice views.

Validation: PostgreSQL HTTP tests cover foreign-profile, missing, storage-unavailable, and draft-invoice access. A migrated-DB receipt submission test verifies a signed URL for the sealed receipt key. Bilingual invoice UI tests cover the link and timeline. Workspace build, typecheck, lint, formatting, OpenAPI, and backlog checks run before push; GitHub CI runs on the pushed commit.

Remaining: bank name and a complete review-event timeline are not stored in the current receipt model, and there is no dedicated bank-receipt list page yet.
