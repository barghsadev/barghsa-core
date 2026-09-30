# Customer guide conversation context

Canonical work: `07-ui-ux-design.md#T-07.20.01.03`, `.04` and the customer profile-isolation portion of `.08`. This batch completes the auto-growing chat input and adds a localized welcome with the active profile's authorized display name in both the slide-over and full-page guide. A missing profile name falls back to the profile type rather than exposing an ID. Switching profiles removes the old conversation before the new availability response arrives.

The previous full-page batch introduced a route hook in the dashboard layout. Two navigation unit tests rendered that layout outside a router and failed on `main`; this batch updates their route mocks. The combined coverage job only failed because it requires the test job to pass.

Validation: five Chromium assistant flows, including auto-growing input and profile-switch conversation isolation; five knowledge-assistant HTTP integration tests; two navigation unit tests; 25 dictionary-message tests; root typecheck, lint, format, build, bundle budgets and backlog validation. The remaining chat criteria include policy badges, contextual suggestions, streaming, write-action confirmation and staff-role scope.
