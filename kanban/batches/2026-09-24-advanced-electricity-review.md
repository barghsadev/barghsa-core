# Advanced electricity order review

Canonical scope: `03-core-business.md#T-03.06.04.05` final review and submit snapshot.

The advanced order's final review now shows the selected profile, entered gift code, delivery address and postal code alongside its existing period, product, price and wallet details. It also presents the contract preview, cancellation/refund terms and payment timing before submission, using the same localized policy copy as simple electricity checkout. No new request or dependency is needed.

Validation: focused English/Persian review tests, web typecheck, changed-file lint and formatting, and workspace build pass. The production route-budget checker still fails on the existing Login, Register, Password recovery and Electricity ordering budgets; none is a new advanced-review route budget. Direct `main` CI will be tracked after push.
