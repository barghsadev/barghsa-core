# Saving order changes after approval, before payment

Canonical scope: the remaining customer before-payment change case in `03-core-business.md#T-03.09.04.05`.

Customers may revise hardware or installation address while an approved saving order is still unpaid, before delivery advances. The existing quote and confirmation flow recalculates the original unpaid invoice and creates an immutable contract version and order revision. The order returns to staff review. If the customer accepted the earlier contract, that version's acceptance remains in history; the new version requires publication and acceptance again.

Approval allocates tracked hardware. An address-only correction keeps that allocation. A hardware correction converts it to a timed reservation in the same transaction, then the existing hardware-change trigger moves the reservation. The invoice ID remains stable, and payment or receipt activity, cancellation, and advanced delivery block further customer changes.

Validation: saving-order HTTP integration covers postapproval address and hardware changes, accepted-contract reset, inventory counts, invoice amount, reapproval, and a pending receipt that blocks further edits. Contract-review HTTP integration, production build, typecheck, lint, formatting, and backlog validation run before push.
