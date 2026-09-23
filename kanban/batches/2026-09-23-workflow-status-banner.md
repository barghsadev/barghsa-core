# Customer workflow status guidance — September 23, 2026

Canonical task: `03-core-business.md#T-03.90.16`.

A reusable bilingual `WorkflowStatusBanner` now shows the current state, recent event or reason, next available action, responsible party, and support link. Customer electricity, saving, solar, consultation, and current contract detail views use it. Existing status and next-action fragments were consolidated, while domain-specific action links and staff-only controls remain in their respective pages. Solar document/postal steps and consultation offer/information steps link to the relevant on-page controls.

Validation: all 970 web tests, 53 dictionary tests, focused detail-page tests, web typecheck and production build, targeted lint and formatting passed. The backlog validator remains green. CI for this batch is pending after the direct `main` push.
