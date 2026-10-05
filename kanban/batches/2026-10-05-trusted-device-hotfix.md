# Trusted-device hotfix, v0.1.3

The user reported that subsequent customer and staff/admin logins still asked for OTP after selecting device trust. Login code completion automatically submitted before a later trust selection, and staff/admin accounts explicitly bypassed the trust lookup and rejected trusted sessions.

OTP login now uses the existing confirmation button. Other OTP consumers retain their completion callbacks. All account types accept the existing opaque HttpOnly browser proof on the same observed network while trust is valid. New/missing/imitated cookies, changed networks, expired and revoked trust still require OTP. Account/version checks, transactional trust locking, audit, logout revocation and sensitive-action step-up remain.

The related API set has passing evidence for all 153 distinct cases, including actual OTP delivery, trust opt-in, logout/return login for customer/staff/admin, spoofing, expiry, revocation and lock races. The first run passed 151 cases; two server startups overlapped the browser setup's shared-package rebuild and failed with a missing compiled module. Only those two cases were rerun after that build completed; both passed without implementation changes. Logs retain the failure and retry. After an exact-checkout build, use `BARGHSA_TEST_PREBUILT=1` for both HTTP and browser tests to avoid rebuilding shared outputs during concurrent suites.

All 25 selected frontend cases and all 60 English/Persian Chromium/mobile Safari login cases pass. API/web builds and typechecks, changed-file lint/format, OpenAPI compatibility, all 85 existing payload budgets and static security checks pass. Source review confirms preserved trust/account checks and correct staff context after a concurrent account change. Reviewed Persian screenshots show v0.1.3 and the editable trust option after a completed OTP.

This fix joins the asynchronous staging deployment changes in the first v0.1.3 release. The earlier job was cancelled before service rollout; staging remained on v0.1.2, with no v0.1.3 announcement. Push normally to `main`, enqueue the exact pushed commit and reviewed public login screenshot, and let the detached worker deploy and announce Persian notes without a CI gate. Publication, rollout and Telegram results are external receipts, not claims made before completion.

Evidence: `~/.local/state/barghsa-manual-batches/trusted-device-hotfix/`. Reuse `02-auth-users-admin.md#T-02.01.02` and `#T-02.01.03`; do not recount existing domain engines or modify historical supervisor state.
