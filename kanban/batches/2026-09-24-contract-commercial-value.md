# Versioned contract commercial value

Canonical scope: partial progress on `07-ui-ux-design.md#T-07.18.03.01`, the contract list/detail amount pattern.

Staff can state a fixed whole-IRR contract value or a variable-price rule while authoring a draft. The value is stored in the immutable version content and therefore participates in the existing review, publication and customer acceptance flow. Customer lists read the latest published version; staff lists read the working version. Both lists and the customer terms render fixed values exactly, including amounts above JavaScript's safe integer range, or explain the variable rule. The API rejects malformed values and amounts above signed 64-bit IRR range. Contracts without a stated commercial value do not borrow the initial invoice amount as a total.

This adds an explicit value for authored versions. `2026-09-24-order-contract-value-snapshots.md` extends it to new electricity and saving order contracts using their full committed quotes. Historical versions are not rewritten; solar construction remains unstated until a defensible full value is available. No amount is inferred from a deposit or first invoice. A dedicated contract number and signed legal-party snapshot remain open.

Validation: PostgreSQL HTTP tests cover fixed and variable values in staff/customer list responses, persisted version content, and invalid amounts. Bilingual UI tests cover exact fixed amounts, variable rules, authoring and invalid input. Production build, workspace typecheck, lint, formatting, OpenAPI and backlog checks run before push.
