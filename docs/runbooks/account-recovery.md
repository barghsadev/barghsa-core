# Account recovery support

Applies to `02-auth-users-admin.md#T-02.03.03`. This runbook documents current intake, supported actions and escalation. Recovery after loss of every registered contact remains incomplete: the owner must define authorized recovery approvers and identity checks, and the app needs a reviewed way to apply that decision. This document does not authorize a credential override.

## Contact and intake

The public `/support` page is linked below the authentication forms. Contacts confirmed by the owner on 2026-09-08:

- Email: info@barghsa.com
- Office: 021-26658042
- Mobile: 09002550292

Support reviews requests without promising a fixed completion time. The previous 24-hour promise had no confirmed service agreement and was removed.

Record an intake reference, receipt time, receiving staff member, the claimant's supplied account identifier, a reply contact, which registered channels they can still access, and the requested help. Treat the supplied identifier and new reply contact as unverified. Do not disclose whether an account exists or its stored identity/contact details to an unverified claimant.

Passwords, OTPs, session cookies and reset links must remain with the user and the application. Staff must not collect them. Identity evidence must use an approved restricted channel and retention procedure; ordinary email or a public attachment URL is not that procedure. Selection of that channel is part of the pending owner policy.

## Route the request

| Situation                                                                    | Supported action                                                                                                                                                                 | Required result                                                                                                          |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| User can receive a code at the registered login contact                      | Direct the user to `/forgot-password` and let them complete verification and password entry themselves.                                                                          | The app confirms the reset. A sent-code message alone is not recovery.                                                   |
| Signed-in user can prove control of the existing and proposed login contacts | The existing username-change API requires linked old/new challenges and consumes them together. Use it only through its authenticated application workflow.                      | A successful committed username change; a CRM profile-contact edit is not a substitute.                                  |
| User reports loss of all registered contacts                                 | Keep the request pending identity review. Escalate to the owner-designated recovery approver once that role and evidence policy are defined.                                     | An explicit decision with evidence and a supported execution path. Do not claim restored access while either is missing. |
| Credible compromise requires containment                                     | An authorized staff member may use the existing CRM session-expiration or forced-password-change action after recent step-up. Record the case reference in its mandatory reason. | Read back the result and audit record. Revocation contains access; it does not recover the account.                      |

If an action fails, permission was revoked, the target changed, or evidence conflicts, record the failure and retain the unresolved request. Do not retry a different account, change ownership or edit stored credentials to make the request appear successful.

## Identity review and audit record

The application has no automatic identity-verification provider. A verified profile flag, caller ID, knowledge of a national identifier, a receipt screenshot or possession of a newly supplied email address does not by itself prove control of the existing login account.

Before a lost-contact recovery can be approved, the owner-defined procedure must establish all of the following:

1. Which staff role may collect evidence, which role may approve recovery, and whether a separate reviewer is required.
2. Accepted evidence and verification steps for the existing account owner, including a legal entity's authorized representative when applicable.
3. The restricted evidence store, access controls, retention rules and a stable evidence reference.
4. A record tying the intake reference to the immutable target user ID, relevant profile ID, requested contact change, identity findings, reviewers, reasons, timestamps and decision.
5. A supported execution method that verifies the proposed new contact, prevents stale or repeated approvals, invalidates applicable sessions/tokens, and records before/after changes with the actor and correlation ID.
6. Read-back of the committed outcome and a user-completed login before recording recovery as complete. Notification to existing contacts and handling of contested ownership must follow the approved policy.

These are unresolved acceptance requirements, not checks this runbook claims have been performed. Until the policy and execution method exist, support can intake, guide ordinary recovery and escalate; it cannot approve a lost-contact credential replacement.

Keep the full case history, including failed attempts and rejected evidence. Existing auth/CRM audit events support investigation, but the staff-permission audit page is not a complete account-recovery timeline. A designated operator must retrieve the relevant account and staff events under authorized audit access. Never add raw credentials or copies of identity documents to ordinary application logs.

## Current application boundaries

| Operation                                           | Authorization and behavior                                                                                                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/reset-password`                     | Purpose-bound, unexpired, unused OTP with the current account authentication version. Password history applies. Reset revokes sessions and consumes refresh tokens, and writes `password_reset` in the same transaction.                                                  |
| Authenticated username change                       | Requires linked old/new contact OTPs. A successful change preserves only the current session and records `username_changed`. It is not a staff recovery endpoint.                                                                                                         |
| `PUT /api/crm/profiles/:profileId`                  | `crm:edit`; edits title and profile contact details. It deliberately preserves `users.username`, `users.email` and `users.mobile`.                                                                                                                                        |
| Identity correction cases                           | Creation requires `crm:edit-identity`, review requires `crm:verify`, reading requires `verification:read`; mutations require step-up. Evidence is sealed and a different staff member reviews. Corrections affect allowed profile identity fields, not login credentials. |
| `POST /api/crm/users/:userId/expire-sessions`       | `admin:users:edit`, recent step-up and a reason. Records `expire_sessions` with target user and actor.                                                                                                                                                                    |
| `POST /api/crm/users/:userId/force-password-change` | Same capability, step-up and reason. Revokes sessions, sets the next-login password-change requirement and records `force_password_change`; it does not give staff a new password or bypass login.                                                                        |

The authentication-version database trigger invalidates old account challenges after credential or account-state changes. Operators must not disable it or write directly to credential tables as a recovery shortcut.

## Evidence and remaining work

Reviewed against [authentication service](../../apps/api/src/auth/auth.service.ts), [CRM controller](../../apps/api/src/crm/crm-v2.controller.ts), [CRM service](../../apps/api/src/crm/crm-v2.service.ts), [correction controller](../../apps/api/src/crm/verification-case.controller.ts), [correction service](../../apps/api/src/crm/verification-case.service.ts) and [authentication-version migration](../../packages/db/drizzle/production/0087_authentication_version.sql).

Local tests cover existing reset, CRM contact separation, correction permissions and session revocation. They do not certify the missing lost-contact recovery policy or implementation. Record their exact runs and this task's remaining criteria in [audit acceptance](../../audit/acceptance-closure.json) before closing the task.
