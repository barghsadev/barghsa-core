# Solar history in the account timezone

Canonical scope: `07-ui-ux-design.md#T-07.09.01.05`, applied to the solar request and staff handoff journey.

Customer solar request lists and details now display submission, request history, and agreement acceptance in the saved account timezone. Staff document review and postal queues use the same explicit timezone for request and upload dates. Each screen shows the existing retry notice if the account timezone cannot be loaded instead of falling back to the browser timezone. The stored UTC instants and date-only postal fields are unchanged.

Validation: the solar invoice-to-contract browser journey confirms that a UTC September 23 submission appears on September 24 for a UTC+14 account. Solar intake, staff rejection, and focused staff queue/document tests pass. Web typecheck and formatting pass.
