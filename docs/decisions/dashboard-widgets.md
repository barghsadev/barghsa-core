# Dashboard widget semantics

Customer widgets load after the server resolves the active profile and its permissions. Each granted widget owns its read and retry. Customer reads use the shared server-query cache; staff reads use `useAsyncData`. Both bind results to the current account and profile context. A failed section does not block its siblings. Denied data is hidden, and a reply for another profile cannot populate the current dashboard.

The widget grid has one column on mobile, two on tablet and three on wide screens. Each mounted widget reserves a fixed card height across loading, empty, error and ready states. Long content scrolls inside the card with keyboard access. This reservation applies to widget loading after profile/context resolution.

The four quick counts distinguish active contracts, orders in progress, the customer's open tickets and unpaid invoices. The order count combines the current electricity and saving workflows without counting legacy wrapper rows twice. Its links open the corresponding filtered service lists. Missing permission contributes no private count.

Recent orders show the latest five submitted electricity and saving orders together. Electricity submission creates its order, contract and initial invoice atomically, so an order awaiting staff review is included before contract publication. The amount comes from its current initial invoice. Saving orders without an invoice show that the amount is unavailable. Private wizard drafts do not become submitted orders.

Upcoming invoices show the first three due items. The wallet warning includes every outstanding balance, rather than just those three. Due-day urgency uses the account timezone. The payment link opens invoice details; it does not authorize or perform payment. Invoice details apply the [financial confirmation safeguards](financial-and-service-status.md).

Active-contract progress describes elapsed service time between the recorded start and end dates. It does not establish fulfillment, delivery or installation. Missing or invalid term dates show that progress is unavailable.

Pending company invitations appear above the dashboard in the shared customer shell and remain until a recorded decision. Their privacy, account binding and decision safeguards are described in [customer setup and delegation](customer-setup-and-delegation.md).

Staff verification shows the full pending count and latest five non-archived profiles. Verification disabled by policy returns no pending identities. Staff work queues and failure sections resolve their own current permissions. A category outside those grants is absent, rather than a misleading zero.

Open business work includes all unresolved refund obligations. The failure section separately flags the failed or exhausted subset, alongside failed background jobs and open notification dead letters. Counts link to the authorized work pages. A count or severity color does not approve a refund, replay a job or confirm a delivery.

The chargeback warning retains an accepted nonzero warning during a refresh failure and labels that failure. A stale zero becomes a retryable error, so an unavailable finance read cannot claim that no exceptions remain.
