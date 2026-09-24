# Electricity contract terms at checkout

Canonical scope: customer review and submission within `03-core-business.md#T-03.05.04.05` and `03-core-business.md#T-03.06.04.05`, with the linked preliminary contract workflow in E-04.

Simple and advanced electricity checkout now show the selected template's rendered text, name, and version in the final review. The preview and submission use the same template-snapshot routine as contract creation. The quote digest includes that snapshot, so a changed selection or rendered text rejects stale submission before an order is written. The advanced wizard refreshes the quote after a conflict; both wizards give a bilingual review-again message. When no template is configured, the existing contract-process explanation remains visible.

Validation: the focused API contract-template and order suites, simple and advanced web tests, API/web/i18n TypeScript, changed-file lint and formatting, and the canonical backlog check passed. The HTTP integration test verifies that previewed terms equal the saved contract snapshot and that switching versions invalidates the prior digest.
