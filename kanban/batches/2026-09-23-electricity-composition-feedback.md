# Electricity composition limit feedback

Canonical scope: `03-core-business.md#T-03.04.03.04`.

Simple and advanced electricity ordering now translate structured quote failures into specific, localized product-limit feedback. When mandatory green composition requires more than the green product allows, the customer sees the required and allowed kWh and can adjust the order. The configured percentage and server calculation remain unchanged. Unknown or network failures retain the generic preview message.

Validation: shared translator tests cover English and Persian maximum conflicts, minimum conflicts, and fallback behavior; the simple ordering UI test confirms the green conflict appears and checkout stays blocked. All 959 web tests, build, typecheck, lint, formatting, OpenAPI contract, and backlog checks passed.
