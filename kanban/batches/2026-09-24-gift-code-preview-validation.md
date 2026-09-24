# Customer gift-code preview

Canonical scope: `03-core-business.md#T-03.02.03.01` and `03-core-business.md#T-03.02.03.02`.

Authenticated customers can call `POST /api/gift-codes/validate` with a code, owned active profile, pre-discount order amount, and product category. The response gives the normalized code and estimated IRR discount. The endpoint enforces the shared validation rate limit and checks activation, date window, profile scope, usage limits, minimum amount, and category through the same rules used by atomic redemption. Preview only reads; it neither reserves a slot nor inserts a redemption. Final order submission repeats validation under the gift-code row lock.

Validation: HTTP integration tests cover repeated preview against a one-use code without consuming it, profile access, minimum order, category, and inactive status. Gift-code service tests, API build and typecheck, lint, formatting, OpenAPI contract, and backlog checks pass before pushing to `main`.
