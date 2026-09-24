# Explicit solar contract values

Canonical scope: further progress on `07-ui-ux-design.md#T-07.18.03.01`, the contract amount shown during customer tracking.

Staff creating a solar construction contract must state either a full fixed IRR amount or a variable pricing rule. The selected value is validated and stored in the initial immutable contract version in the same transaction as contract and invoice creation. The first invoice remains a separate payment and is never inferred to be the full contract value. Customer and staff contract lists display the stated value through the existing published-version rules. Historical contracts are not rewritten.

Validation: solar HTTP integration tests check required and invalid values, invoice separation, and version storage; web component tests cover fixed and variable entry. Workspace build, typecheck, lint, formatting, OpenAPI, and backlog checks pass before push.
