# Solar customer next actions — September 23, 2026

Canonical scope: customer visibility for the solar request states in `03-core-business.md#T-03.11.04.01` and part of the cross-workflow guidance in `T-03.90.18`.

The customer solar request list now uses the same bilingual next-action rules as the detail page. It shows who acts next for document upload, staff document review, postal submission, final review, and a published contract. The list API supplies the contract publication fact so a created but unpublished contract is not offered as customer action. When staff request replacement documents, the detail page highlights document upload as the current stage.

Validation: solar request HTTP integration, four Chromium customer-route cases, focused solar component tests, API and web typechecks, web production build, targeted lint and formatting, and backlog validation passed locally. CI is pending after the direct `main` push.
