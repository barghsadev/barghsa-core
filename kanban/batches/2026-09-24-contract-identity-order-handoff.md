# Contract identity and order handoff

Canonical scope: partial progress on `07-ui-ux-design.md#T-07.18.03.01`, contract list/detail composition and linked-order prerequisites.

Customer and staff contract lists show the full contract reference and the current account display name and profile type. The customer list opens the linked electricity or saving order, and contract detail repeats the reference so the selected record remains identifiable. List data stays profile-scoped for customers and behind the existing staff permission. An account display name can change with the profile; it is not presented as an immutable legal-party snapshot. A dedicated contract number remains separate work; versioned commercial values were added in `2026-09-24-contract-commercial-value.md`.

Validation: contract HTTP integration tests verify the account and order fields in customer and staff lists, plus cross-profile isolation. Bilingual UI tests cover the contract reference, account, linked electricity order, and saving-order link. Relevant build, typecheck, lint, formatting, OpenAPI and backlog checks run before push.
