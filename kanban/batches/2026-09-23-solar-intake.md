# Solar construction intake batch

Canonical scope: `03-core-business.md#T-03.11.01.01`–`.03`, `T-03.11.02.01`–`.06`, and `T-03.11.03.01`–`.03`.

Customers can select a building/apartment or non-household site, enter the fields relevant to that selection, choose on-grid or off-grid operation, accept the displayed registration terms, and submit a solar construction request. The on-grid path requires a bill identifier; the off-grid path displays the technical storage disclaimer. The form shows all five contract-preparation stages. Submission redirects to the new request detail page and creates no contract or invoice. Requests can be listed and read only by users authorized for the profile. Submissions are idempotent per user and submission key.

The new request, document-review, and postal tables prepare the later document and postal batches. Request status values cover the planned workflow, and database constraints protect submitted request shape, agreement evidence, and terminal decision reasons. This batch does not add the later staff transition, document upload/review, postal, or contract-link actions.

Validation: migrated HTTP flow for both site types, invalid input, profile authorization, idempotent retry, agreement snapshot, audit, and no contract/invoice; customer form tests in Persian and English; TypeScript, build, lint, formatting, database snapshot, OpenAPI contract, and backlog checks.
