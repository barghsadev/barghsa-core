# Electricity supply unavailable guidance

Canonical scope: the customer-facing part of `03-core-business.md#T-03.90.07`.

The ordering API already rejects a required electricity product that is inactive, missing, or unpriced, and fails closed when mandatory green supply is unavailable. Simple and advanced checkout now identify those quote errors as a temporary service unavailability instead of asking customers to change their quantity or gift code. Both checkouts show a direct support link. Quantity-limit errors retain their specific correction guidance.

Validation: quote-error tests cover inactive/unpriced product and mandatory-green error mapping in Persian and English. Advanced checkout integration shows the unavailable message and support link; the error notice and both order page tests pass. Web typecheck, build, lint, formatting, OpenAPI, and backlog checks run before push.
