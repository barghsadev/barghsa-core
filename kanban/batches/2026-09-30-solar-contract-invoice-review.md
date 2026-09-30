# Solar contract and initial invoice review

Canonical work: `03-core-business.md#T-03.11.04.01` and the solar portion of `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04`. Cross-command financial review remains partial.

Before staff creates a solar contract, the API now reviews the approved request, active template or uploaded source, full draft terms, stated contract value, exact invoice lines, VAT, total, and current manual-invoice due rule. The staff dialog displays the authoritative values. Creation requires the review hash and rechecks the same data inside the transaction; changed source, invoice lines, or due-period rules reject the action. The issued invoice is compared with the reviewed total and due rule before commit, and the confirmed snapshot is stored in the solar contract audit event. A matching idempotent retry returns the original contract and invoice.

A Chromium test exposed that the confirmation dialog's submit event also reached the underlying form through its React portal, generating a second idempotency key. The form now ignores submit events from nested dialogs, keeping the reviewed key and issued command identical.

The batch also updates older solar document and postal integration fixtures for the previous request-review API, and raises timeouts only for the receipt-upload tests whose first full-suite run hit the default five-second limit under CI load. Those tests still execute and pass.

Validation: focused real-PostgreSQL solar request, document and postal tests; full web unit suite; solar Chromium journeys including the staff contract/invoice review; API and web builds, typechecks, lint, OpenAPI contract, bundle budgets, database snapshot, and backlog validation pass locally. Main CI will run after the push.
