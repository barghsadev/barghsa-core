# Solar contract and invoice batch

Canonical scope: `03-core-business.md#T-03.13.01.02`, the contract and invoice notification portion of `.04`, and reuse of the general lifecycle for `T-03.13.02.01`–`.03`.

After final approval, staff can create one solar draft contract from an active immutable template version or an uploaded request document and enter the actual contract terms. The same action creates and issues an initial invoice with one or more itemized lines. Contract, version, invoice, request link, status transition, audit, and customer notification commit in one database transaction; invalid invoice calculations leave the request approved and create no contract. The request stores a unique contract link, and idempotent retries return the original IDs. Staff can continue the contract through the existing review, publication, acceptance, signature, activation, completion, cancellation, and cancellation-request flows. Existing activation requirements remain visible in the contract workspace.

Customers see the issued invoice from their solar request. The contract link appears only after staff publishes the draft, when the general contract API makes it available; publication sends the existing contract notification. Staff can reach the draft from the postal queue after creation.

Validation: migrated HTTP coverage verifies preapproval rejection, eligible source listing, invoice rollback, atomic creation, invoice linkage, idempotent replay, duplicate prevention, draft privacy, staff publication, and customer availability after publication. Related manual-invoice, contract, activation, and customer UI tests, root build, typecheck, lint, formatting, schema snapshot, OpenAPI contract, and backlog validation were run.
