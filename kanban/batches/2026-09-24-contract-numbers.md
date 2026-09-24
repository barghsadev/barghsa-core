# Stable contract numbers

Canonical scope: partial progress on `07-ui-ux-design.md#T-07.18.03.01`, the contract list and detail pattern.

Contracts now receive a unique, positive sequence number separate from the internal UUID. The migration assigns existing contracts numbers in creation order and advances the sequence before enabling the required default. Staff and customer list/detail APIs return the number as a decimal string to preserve the full bigint range. Lists and details display that number in English and Persian; staff can filter by an exact number. The internal UUID remains the route and database identity.

Validation: database snapshot check, workspace build and typecheck, focused HTTP integration tests, bilingual web component tests, lint, format, OpenAPI, and backlog checks. Historical legal-party snapshots and values for solar or historical generated contracts remain separate work.
