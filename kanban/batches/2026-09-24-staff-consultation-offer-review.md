# Staff consultation offer and invoice review

Canonical scope: `03-core-business.md#T-03.03.03.02` and `03-core-business.md#T-03.03.03.03`.

Staff consultation detail now displays the saved offer independently of the editable fee form: fee, scope, deliverables, deadline, and the current invoice state. Its invoice link opens the exact invoice in the finance ledger, subject to the ledger's existing `invoices:read` permission. The staff detail API joins the current invoice so a replaced invoice does not supply a stale state.

Validation: the consultation workflow integration test confirms the replaced invoice and saved offer fields in staff detail. The customer/staff browser journey passes in all five projects and verifies the staff invoice link and payment state. API and web TypeScript, changed-file ESLint, and Prettier pass locally.
