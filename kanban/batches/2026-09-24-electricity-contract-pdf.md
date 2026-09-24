# Electricity contract PDF generation

Canonical scope: `04-invoices-wallet-contracts.md#S-04.5.04`, especially document lifecycle and `T-04.5.04.02`.

Staff can generate a PDF from the immutable electricity template text saved on a contract version. The PDF includes the contract number and version, supports Persian and English text, links to that exact version as an original or amendment document, and enters the existing review lifecycle. It must be approved before staff can request signature. Repeated generation with the same version key resumes the same document. Staff can attach or generate the amendment PDF after customer acceptance while the effective version remains unchanged until signing.

This batch adds a staff action to the contract detail and a production database guard migration. Original and accepted-amendment HTTP flows with real object storage, idempotent retry, PDF download and signing request are covered. The staff web action is covered in a component test; a rendered Persian PDF was visually checked. Automatic initial generation at order submission is covered by the [following batch](2026-09-24-automatic-electricity-contract-pdf.md); this staff action remains for manually created electricity contracts and amendments.

Validation: 13 contract-signature HTTP tests, 38 contract-workspace web tests, root build, typecheck, lint, format, OpenAPI, database snapshot and backlog checks passed. The contract admin route passes its 500 KB bundle budget. The separate global bundle-budget command still fails on unrelated login, registration, recovery, dashboard, electricity-ordering and admin terms routes.
