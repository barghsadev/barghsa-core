# Contract service and initial invoice overview

Canonical scope: partial progress on `07-ui-ux-design.md#T-07.18.03.01`, the contract list overview. Contract number, legal party, and full contract value remain separate work; an initial invoice amount is labeled as an invoice amount, not as the contract value.

Customer and staff contract lists now show the version's service start and end when recorded, plus the initial invoice amount and current invoice state when linked. The customer row opens that invoice. The customer API takes these values from the latest published version; staff see the current working version. Invoice joins remain scoped to the contract profile, and amounts are returned as exact decimal strings so large IRR values are not rounded in JavaScript.

Validation: PostgreSQL HTTP tests cover customer and staff data plus cross-profile isolation. Bilingual web tests cover period, amount, invoice link, and staff presentation. Workspace build, typecheck, lint, formatting, OpenAPI, and backlog checks pass before push; GitHub CI runs on the pushed commit.

Later progress: `2026-09-24-contract-identity-order-handoff.md` adds the contract reference, current account display and linked-order navigation. `2026-09-24-contract-commercial-value.md` lets authored versions state an exact fixed value or variable rule. A dedicated contract number, immutable legal-party snapshot and automatic values for system-generated contracts remain open.
