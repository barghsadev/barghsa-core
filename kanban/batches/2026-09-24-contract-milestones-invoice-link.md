# Customer contract milestones and invoice handoff

Canonical scope: `07-ui-ux-design.md#T-07.18.03.01`, customer contract list/detail composition and linked invoice prerequisite.

The customer contract list now shows publication and acceptance times already returned by the API. Contract detail and the version history show those milestones for each available version in the saved account timezone. When an activation version has an initial invoice, customers can open that invoice directly from the prerequisite panel. Staff retain the existing invoice indicator without a customer-route link. No contract or invoice state changes.

Validation: focused contract workspace and activation tests cover the dates and bilingual invoice link. The contract activation browser journey checks the link in both languages. Workspace build, typecheck, lint, formatting and backlog validation run before push; GitHub CI runs on the pushed commit.
