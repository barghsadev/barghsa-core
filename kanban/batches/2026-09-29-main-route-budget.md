# Main route payload budget

Task context: `01-platform-infrastructure.md#T-01.03.04` (remaining main-route slice).

Customer electricity ordering, saving plans and wallet top-up remain eager as required by `T-01.03.03`. The wallet now imports a narrow shared finance entry so unused review schemas stay out of the initial customer bundle. A lightweight UUID guard no longer pulls staff date-picker code into wallet and order pages. Toast rendering loads only when feedback is requested, with queued messages delivered after the renderer mounts and its own interaction budget. The dashboard navigation gets its four labels from the already-loaded app dictionary, so opening the shell no longer pulls in the solar, consultation, contract and document dictionaries. The labels remain bilingual and unchanged.

The dashboard measures 255.0 KB against its 300 KB limit, and electricity ordering 247.2 KB against 250 KB. All 57 configured route and interaction budgets pass in both the default-gzip check and Size Limit. The admin terms interactions have independent limits in the companion batch.

The production Chromium electricity order, saving order and wallet payment journeys pass after updating their mocked sessions to reflect current customer/staff context requirements. The electricity journey also verifies the on-demand success toast. Login and recovery browser checks pass after updating their session and branding fixtures. Web, shared, UI and i18n checks, focused component tests, route-budget regression tests, lint, formatting and backlog validation pass.
