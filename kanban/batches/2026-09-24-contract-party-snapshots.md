# Contract party at acceptance

Canonical scope: partial progress on `07-ui-ux-design.md#T-07.18.03.01`, the contract list and detail pattern.

On every new contract acceptance, a database trigger records the customer's profile type, name, legal identifier, and registration number on the immutable, version-bound acceptance row. Staff and customer list/detail APIs expose that accepted party, and the UI labels it separately from the current account name. Later profile edits cannot change the accepted party. Historic acceptance rows remain without a snapshot because their original details cannot be reconstructed reliably.

Validation: database snapshot check, workspace build and typecheck, HTTP integration tests proving name changes leave the accepted party unchanged, bilingual web component tests, lint, format, OpenAPI, and backlog checks.
