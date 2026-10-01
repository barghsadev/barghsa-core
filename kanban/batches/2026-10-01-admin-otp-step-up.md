# Sensitive admin actions with OTP, October 1, 2026

## Kanban scope

This batch completes `07-ui-ux-design.md#T-07.30.01.06` across email/SMS provider settings and tests, the dual-approval threshold used by refunds/bank payments/manual adjustments, and staff role replacement. Shared StepUpAuthGate runs inside the captured-action dialog. Remaining admin page criteria, broader form adoption and unfinished domain journeys remain separate work.

## Behavior and review

An explicit send requests a code for an existing primary or verified account identifier. The response contains an opaque challenge ID, expiry and delivery channel, never the code or destination. The existing encrypted outbox, delivery worker, issuance quotas and attempt limits handle delivery. SMS prefers a dedicated step-up template and falls back to the existing login template when absent. Revoked or expired sessions cannot dispatch step-up deliveries.

Challenges bind to the account, exact session, authentication version and purpose. A replacement challenge invalidates its predecessor. Verification serializes current account/session authority and challenge consumption. Wrong attempts persist; foreign sessions, changed credentials, exhausted attempts and expired deadlines cannot authorize an action. Verification rotates session, refresh and CSRF credentials, then atomically records OTP proof and safe audit evidence. Audit failure or expiry during lock waits rolls back consumption, rotation and proof.

Password proof alone cannot authorize the selected mutations. Each transaction checks current OTP proof before work and again before commit or external delivery. The existing fifteen-minute proof policy remains. Other password-confirmed actions retain their current behavior. Existing sessions remain valid but have no OTP proof until verification.

The inline form supports Persian and Arabic digits, one-time-code autocomplete, keyboard submission, explicit resends, quota countdowns and wrong-code retry. Each mutation reads fresh CSRF credentials after rotation and retries its captured body. Cancellation, unmount, disabled confirmation and permission denial prevent late verification responses from dispatching obsolete work. Provider read failures retain drafts and entered codes; changed targets invalidate confirmation. Threshold denial clears private state.

Migration 0232 adds nullable session proof and challenge-session fields, a session foreign key/index and purpose-binding constraints. It preserves existing data and uses the repository's ordered migration journal. The generated OpenAPI contract adds only the two OTP endpoints. Review also corrected fixtures to expire OTP proof, parse rotated cookies and use the threshold's own translation dictionary and model cookie installation explicitly for WebKit mocked responses. Real cookie rotation is verified by the API HTTP tests.

## Validation

The full web suite passes 1,746 cases across 151 files. The final migrated PostgreSQL API run passes 116 cases across the OTP flow and provider mutation boundaries. The other 337 cases across 23 related API files passed in the preceding related run. Together they provide passing evidence for 453 distinct API cases, not a fresh full-suite run of 453. The final delivery-worker run passes 41 cases; all 53 dictionary cases pass. Failed, interrupted and repeated runs are excluded.

All 56 final production browser scenarios pass across Chromium and mobile Safari, both languages and themes. They exercise each protected action, wrong-code retry, exact captured bodies, rotated CSRF credentials, provider recovery, threshold validation, keyboard focus, scoped Axe and mobile bounds. Persian mobile dialogs in both themes were inspected.

Root build, types, lint and formatting pass. The final browser fixture and test also pass web types and lint. Database snapshot, additive OpenAPI contract, suppression checks and all 64 route budgets pass. Backlog validation covers 1,355 tasks and 116 traceability entries. The pinned security scanner passes five fixtures and scans 1,347 files with zero findings or scanner errors. Diff checks pass.

## Publication

The preceding audit commit is `9e942b3914b3428d370f6f35127381399a105c2b`. CI run [36862045325](https://github.com/barghsadev/barghsa-core/actions/runs/36862045325) has passed security, secret scanning and integrity, with tests still running at the latest read. Existing temporary fast mode and combined-coverage exemption remain unchanged. No coverage measurement is claimed from the exemption.

This batch is committed and pushed directly to main after local validation. Remote SHA, clean worktree and exact-commit CI registration are read back after publication. No PR, supervisor state, external handoff or scheduler change is included.

## Commands

- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `pnpm --filter @barghsa/web exec vitest run`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/auth/otp-step-up-http.integration.test.ts src/provider-config/provider-mutation-http.integration.test.ts`
- Related API run covers provider-config, staff sensitive actions/mutations/HTTP, dual-approval threshold service/controller, session service/HTTP and OTP service tests.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/worker exec vitest run src/auth-delivery/runner.integration.test.ts`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs admin-otp-step-up.spec.ts delivery-provider-recovery.spec.ts approval-threshold.spec.ts --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `node scripts/check-openapi.mjs --write`; `pnpm check:contract`; `pnpm check:db-snapshot`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper, retaining all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
