# Admin configuration requirements

On 6 November 2026 the owner required the expanded verification, service-target
and escalation specifications before v0.5.0. The current domain controls are a
starting point, not acceptance of the expanded UI tasks.

Verification settings must configure individual and legal profile requirements,
required document types, verification expiry and staff auto-verification, with
versioned draft and active settings. Restricted manual review remains available.
Required documents and expiry must affect actual verification and commercial
access. Staff creation currently auto-verifies its individual profile through an
authorized, audited transaction; the new setting must control that path. It must
not turn an ordinary customer's staff-context selection into identity approval.
Automatic external identity verification remains unavailable until a real
provider is configured and verified.

Service targets must extend beyond the existing ticket, verification-case and
consultation targets to ticket priority, order fulfillment and contract review.
Targets must drive actual timing, escalation and notification behavior. The
expanded escalation editor must support conditions, source and destination roles
or teams, notification choices and timeouts for ticket, order review and
verification workflows. Existing assignment, authority, concurrency, audit and
notification delivery guarantees remain required.

The upload-policy page already exposes versioned category policies, deployment
ceilings and guarded editing. Dual approval retains its threshold editor in the
approval workspace and the elevated, reason-bound emergency action on each
eligible receipt. Team administration retains membership, leads, assignment
strategies and escalation routing. Keeping these existing controls does not
waive the expanded requirements above. Current task status and evidence are
maintained only in `kanban/board.json`.

Wizard draft retention and preliminary electricity contract template selections
use the existing versioned `app_config` keys and audit history. On the
electricity rules page, open the setting’s history, review an earlier revision
and save it as a recovery draft. A separate staff verification step activates
the exact draft as a new revision. A newer save invalidates a draft based on
the old revision. Template recovery rechecks that the selected template
remains active and its placeholders are supported. An explicit selection of
**No template** can also be recovered. Existing submitted orders and contracts
keep their captured terms.
