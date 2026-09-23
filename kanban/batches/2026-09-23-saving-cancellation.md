# Power-saving order cancellation

Canonical scope: `03-core-business.md#T-03.09.05.01` through `03-core-business.md#T-03.09.05.05`.

Customers can request cancellation with a reason from their saving order, including before staff approval. The saving staff page now has a filtered cancellation queue with the customer, plan, bill identifier, and the linked order and contract details. Staff can reject with an explanation or use the existing contract cancellation review to choose the refund amount and destination, obtain any required financial approval, and execute the decision. That shared review uses `/api/admin/contracts/:id/cancellations` instead of adding the older proposed one-call saving endpoint; its prepared decision and exact financial snapshot are retained for audit.

Executing cancellation updates the contract, saving order, and parent order in one transaction. Existing invoice transitions and refund obligations handle unpaid invoices and paid balances. The saving order shows a pending refund until the worker completes it. Inventory is released by the existing saving order status trigger. Completed saving orders cannot be cancelled, and a rejected customer request leaves the contract unchanged. No records are deleted.

Validation: the saving HTTP integration test covers prepublication request, filtered staff queue, rejection, paid cancellation, full wallet refund, inventory release, and completed-order protection. Contract cancellation API tests, customer and staff UI component tests, migrated request tests, production build, typecheck, lint, OpenAPI, schema snapshot, and backlog checks passed.
