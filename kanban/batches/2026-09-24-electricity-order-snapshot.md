# Readable customer electricity order snapshot

Canonical scope: `03-core-business.md#T-03.07.04.02`.

The customer order detail now identifies the account profile by its accessible display name and shows the order method, submission time in the account timezone, and the submitted postal code alongside the existing address, period, quantities, price breakdown, contract, invoice, and timeline. The profile name comes from the already authorized profile; the order-specific address and postal code remain the saved order values.

Validation: the real PostgreSQL electricity-order HTTP suite checks the profile name and saved fields, and the customer UI test checks the rendered snapshot. Production build, typecheck, lint, formatting, OpenAPI contract, and backlog checks run before pushing to `main`.
