# Session caller review

Reviewed through product `5543cc2`. Scope: session creation/rotation/revocation requirements in `02-auth-users-admin.md#T-02.02.01` and `T-02.02.02`. Other authorization criteria retain their own remaining reviews.

| Caller / event | Current credential behavior | Evidence / disposition |
| --- | --- | --- |
| Trusted login | Creates a fresh session, refresh credential and CSRF token under account/trust locks; controller delivers new cookies. | `login` unchanged from `8f857aa`; underlying `createSession` unchanged from `f39132f`. Reuse login/device-trust checks. |
| Login OTP | Successful challenge creates fresh credentials in the same transaction. | `completeLogin` unchanged from `bbb5c66`; reuse OTP replay/expiry/atomicity checks. |
| Password step-up | Replaces session/refresh/CSRF, retaining the original absolute deadline. | `rotateSession` and `verifyStepUp` unchanged from `9469d35`; existing browser cookie/current-session evidence applies. |
| Forced password change | Revokes every existing session and refresh credential; next login creates fresh credentials. | `forceChangePassword` unchanged from `8f857aa`; tested token deadline, history, audit rollback and invalidation. |
| Password-reset recovery | Consumes reset authorization and revokes all credentials atomically; returns to login. | `resetPassword` unchanged from `9827e96`; OTP-first and reset-grant evidence reused. Lost-contact recovery policy remains separate. |
| Staff creation | Creates target credentials, initial roles and verified individual profile after current creator step-up, with atomic audit and delivery outbox. No target session is started. | `640108c`:8 creation HTTP cases,11 authority/race cases and4 browser cases; deadline expiry or changed actor credentials prevents creation. Whole lifecycle acceptance remains separate. |
| Staff activation | Consumes activation link, changes password and invalidates old credentials together; requires login afterward. | `a60cce6`:11 selected HTTP cases including expiry across lock/write waits, one-time use and rollback. |
| Staff role assignment/removal | Changed roles revoke target sessions and refresh credentials; unchanged role sets preserve them. | `staff-http.integration.test.ts` role-change case passes; old session receives401, refresh credential is consumed. |
| Staff disablement | Disable flag, all target sessions, refresh consumption and audit commit together. | `ee5beb2`: two focused HTTP cases verify commit/rollback, two target sessions, unaffected administrator and idempotence. Response now matches documented200. |
| CRM expire sessions / force password change | Account-locked session/refresh invalidation and private user notice. | Both methods unchanged from `337b965`; reuse35 focused checks plus earlier permission races. |
| Ownership transfer | Successful transfer invalidates both owners' sessions and refresh credentials; unrelated accounts remain untouched. | `ee5beb2`: nine ownership HTTP cases pass; strengthened success/rollback tests include actual refresh rows. |
| Self-service single/bulk revocation | Locked actor/confirmation and owner-scoped credentials are checked through commit. | `93dfc27`:41 distinct focused cases; browser evidence reused. |
| Trusted-device removal | Removes the future-login trust record, retains sessions and checks actor/step-up deadlines through writes. | `89e7c53`:12 HTTP cases; next login requires OTP. |
| Suspected compromise via refresh reuse | Revokes the affected family and persists a private, deduplicated security notice. | `redeemRefreshToken` unchanged from `f39132f`; reuse deadline and refresh-reuse alert checks. |
| Profile agent role change/removal | `setAgentRoles` invalidates target credentials with changed membership; no-op preserves credentials. | `8904b03`:13 HTTP cases include change/removal, new-session permission behavior, no-op and audit rollback. |
| Invitation acceptance | Adds membership with current-session rotation and other-session invalidation; original deadlines remain binding through commit. | `5543cc2`:14 HTTP cases,4 registration cases and4 focused browser cases; retries, profile refresh and fresh-CSRF profile switching pass. |

Exact method comparisons and hashes: [session-method-reuse.json](evidence/r01/session-method-reuse.json). All ten selected methods match their cited evidence revisions. This comparison does not renew dependency, whole-file, browser, coverage or production evidence.

The registration matrix and guard repair are now recorded at `455ed61` in [security-route-review.md](security-route-review.md). Finish explicit CSRF alternatives and sensitive-action/audit/UI dispositions, including authorization lost during waits. Full invitation/decline/details and ownership task acceptance remains in F07. This table verifies the specified credential effects; it does not close the whole authentication group. The four session tasks remain partial until remaining criteria and task-wide evidence are reconciled. Full lost-contact recovery still needs the pending owner policy.
