# Electricity preliminary contract template batch

Canonical scope: `03-core-business.md#T-03.90.01`.

Staff can select an active, immutable text template version in electricity ordering settings. The setting is permission-checked, step-up protected, versioned, and audited. New simple and advanced electricity orders read that selected version at submission, render the supported customer name, date, and IRR amount placeholders, and preserve the rendered text and template identity in the preliminary contract snapshot. Existing orders and orders submitted with no selected template keep their previous behavior. A missing template or storage object fails the submission transaction without creating a partial order. The admin UI exposes the version selector in Persian and English.

Validation: contract-template rendering tests, admin HTTP setting tests, selected-template order HTTP integration, and existing electricity-order HTTP integration passed. Root build, typecheck, lint, format check, backlog validation, and OpenAPI contract check were run.
