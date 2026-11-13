# Service targets and escalation

The owner required the expanded targets and routing controls before v0.5.0.
The service-targets page now manages one versioned `admin.service_workflows`
policy. It includes four ticket priorities, verification cases, consultation,
electricity/saving/solar fulfillment, and contract review for those three services.
Each target has a duration in whole hours, a first-notification trigger, optional
email, and an optional timed escalation rule. The editor also accepts whole days
and converts each day to 24 hours. Limits remain 1 to 8,760 hours.

All expanded targets start disabled. Enabling a target replaces the legacy policy
for that work type. In particular, enabling one ticket priority replaces the
legacy ticket target for all priorities. Operators must explicitly enable every
priority they need. The legacy settings remain available for work types without
an enabled expanded target. Legacy workers check this ownership inside their
transaction and cannot also alert a managed work type.

Ticket, verification and consultation clocks use last activity. Ticket customer
waits and terminal states do not run the clock. Consultation retains its existing
staff-wait states. Contract review uses the current `AwaitingStaffReview` period.
Fulfillment clocks use initial submission, so comments or progress updates cannot
extend their deadline. Electricity is monitored through submitted, staff review
and approved states, ending when supply becomes active. Saving review is monitored
before approval; approved/in-progress fulfillment is monitored after payment.
Solar monitors submitted, document review, received postal documents, final review
and approval, ending at contract creation. Customer waits and terminal states are
excluded while those states persist. These internal alerts do not create a
customer-facing service guarantee or alter an order, contract or money ledger.

A breach rule waits from the start of its breach episode. A ticket-priority rule
waits from last activity and also requires the selected priority's target to be
breached. PostgreSQL compares the priority deadline at full timestamp precision.
The source can be any assignee/queue, a role or a team. For assigned work, a source
role/team must contain the current assignee. For an unassigned queue, it must have
an eligible current reader and receives the initial breach notice. The destination
can be administrators, a role or a team. Routing alerts does not transfer business
ownership or grant access. Assigned-only ticket readers can receive notices only
for their own tickets; other recipients require the relevant current read grant.
Disabled/pending accounts and inactive teams do not receive notices.

The first notification can fire on breach or only on escalation. An
escalation-only target must contain a rule. Inbox delivery is mandatory whenever a
notice fires; email is optional at each step. Source/configuration and current
recipient authority remain locked through the episode, audit and outbox commit.
Missing recipients leave the occurrence retryable. Escalation also requires an
active configured worker audit identity, falling back to an active administrator
only when no identity is configured. An invalid configured identity causes an
error and rollback rather than attribution to someone else.

Migration `0280` expands the existing breach ledger with explicit workflow types
and a nullable policy fingerprint. Existing episodes, tier limits and unique keys
remain intact. Expanded rows require the full source timestamp and a fingerprint.
Per-page episode claims, audit and durable channel jobs commit together. Retries
and concurrent scans cannot send a second notice for the same episode/tier.
Recovery, disabling, or a changed target/rule ends that episode; the next applicable
breach starts a new one. Changing a rule can therefore send a fresh notice for
already overdue work, which the confirmation explains.

Configuration writes require both service-target and escalation capabilities,
CSRF, current session and recent password step-up. They compare the saved version
and current role/team references, then audit the old/new policy atomically.
Unknown save receipts hold the editor until a fresh read and explicit reset.
Use **Previous workflow versions** to review an earlier audited policy. The
confirmation displays its durations and routing. Restoring activates the exact
audited policy as a new version after password step-up. The server checks the
current version and role/team references again, and records the source revision
with the new activation. A policy with a retired role or team needs a new edit.
Retain migration `0280` on binary rollback. An older worker does not enforce these
targets, and its healthy process alone cannot certify them. Restore the enforcing
worker before relying on these operational deadlines.
