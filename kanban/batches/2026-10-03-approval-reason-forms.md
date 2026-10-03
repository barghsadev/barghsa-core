# Financial approval reason forms — October 3, 2026

## Scope

This manual batch adopts shared validation, owned server-field feedback, retained drafts and submission locking across the approval queue and direct request handoff together. It advances `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` on these surfaces. These global tasks remain partial; contract cancellation, refunds and other editors still require adoption. Existing approval domain behavior is not counted again.

Each pending request has a separate React Hook Form/Zod Mini reason draft. Rejection validates the existing trimmed 1–2,000-character rule after touch and on submission, with localized linked feedback and invalid-field focus. Approval remains available without a rejection reason. A synchronous queue guard prevents competing approval/rejection while validation settles; controls lock and the selected action displays a spinner through confirmation and verification. The existing per-request cache preserves raw drafts across successful pagination, unchanged refreshes and failed reads.

The rejection API exposes only the public `reason` identifier for owned invalid input. Root and mixed failures stay generic, and valid extra-property stripping remains compatible. Authentication, verification and live financial permission still precede field feedback. Owned errors close confirmation and return focus without clearing any companion draft. Unknown fields, service failures, conflicts and invalid acknowledgements retain the captured proposal for recovery. A success receipt must match both the selected request ID and the chosen resolution before clearing that draft or reporting success. Explicit denial aborts reads and clears private work; generation and current-row checks reject obsolete callbacks and replaced decisions.

Current permissions, second-reviewer rules, exact financial summaries, password/OTP proof, transactional locks, audits, rollback and the distinction between approval and later financial execution remain. Wallet handoff links use the existing theme-aware primary color. No dependency, migration or financial-service change is added. Deploy additive API field metadata with or before the frontend; older responses retain generic correction/retry.

## Review and validation

Feedback reserves its complete localized responsive height, preserving button position across blur and owned-error recovery. Shared form/focus and action-dialog mechanisms remain unchanged. Review separates unavailable controls from actual pending work in the form's busy announcement, and binds success to the acknowledged decision.

- **642 distinct related unit/integration cases** have passing evidence, including **33 additional cases**: API 150/150 across controller/service, resolution and migrated dual-approval HTTP integration; web 424/424 across the new queue form, existing finance recovery, queue navigation, administrator boundaries and action-dialog behavior; dictionaries 68/68. The final affected page run passes 19/19. Repeated runs are excluded.
- The new HTTP case verifies that missing step-up and support-only permission cannot expose reason metadata, that owned/mixed errors are shaped correctly, and that failed input leaves the request pending with no reviewer or review reason. Existing integration covers revocation, CSRF/verification timing, locks, financial resolution, audits and rollback.
- **44 distinct production browser scenarios** have passing evidence on Chromium and mobile Safari: 24 new queue/direct-handoff scenarios and 20 existing approval scenarios. The final affected **24/24** run passes in 19.7 seconds; the existing 20 pass in the preceding run. Both languages/themes, invalid-submit focus, linked feedback, exact six-attempt rejection bodies, password failure/retry, companion drafts, duplicate submission, owned/mixed errors, service failure, mismatched acknowledgement, denial/recovery, RTL, mobile bounds and scoped Axe pass. Persian dark mobile feedback is visually inspected. Browser APIs are mocked; migrated HTTP tests verify real transactions separately.
- Final root build passes 7/7 tasks and type checking passes 11/11 packages. Zero-warning lint and all **74 unchanged budgets** pass. Strict SAST passes five fixtures and scans **1,531 files with zero findings or scanner errors**. Contract/suppression checks pass; root formatting and backlog/diff checks are verified before publication. The backlog validates 1,355 tasks and 116 traceability entries.

The initial browser run passes 28 and fails 16: all failures stop at a background button role locator that the open confirmation dialog correctly hides from accessibility queries. The retained-control assertions now explicitly include hidden background roles; focus, busy, disabled, validation and retry assertions remain. The final 24-case affected run passes. The old rejection browser assertion now exercises invalid submission and focus instead of expecting an unusable disabled blank action. No timeout, test gate or budget is weakened.

Exact commands:

```sh
pnpm --filter @barghsa/api test src/admin/dual-approval.controller.test.ts src/admin/dual-approval.service.test.ts src/admin/dual-approval-resolution.test.ts src/admin/dual-approval-http.integration.test.ts
pnpm --filter @barghsa/web test src/pages/AdminApprovalRequestsPage.test.tsx src/components/contract-finance-list-recovery.test.tsx src/pages/decision-queue-navigation.test.tsx src/pages/admin-boundaries.test.tsx src/components/TeamActionDialog.multipart.test.tsx
pnpm --filter @barghsa/web test src/pages/AdminApprovalRequestsPage.test.tsx
pnpm --filter @barghsa/i18n test
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e approval-reason-forms.spec.ts approval-queue.spec.ts --project=chromium --project=mobile-safari --workers=2
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e approval-reason-forms.spec.ts --project=chromium --project=mobile-safari --workers=2
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:bundle
pnpm check:contract
pnpm check:suppressed-errors
python3 scripts/check-sast.py --report /tmp/barghsa-approval-reasons-sast.json
python3 kanban/scripts/build_backlog.py --check
git diff --check
```

## Publication and continuation

This batch is published with a conventional commit and normal direct push to `main`. Local/origin/advertised/GitHub SHA agreement, clean checkout and exact-commit CI registration are read back after publication. At the latest read, preceding wallet-confirmation CI run `37125016662` has passing integrity, static-security and secret checks while tests remain running. Superseded threshold run `37123784342` is cancelled, not passed. New remote CI remains separate from local validation.

Contract cancellation request/decision editors are the next related adoption batch. No PR, scheduler, external supervisor state, generated queue or historical completion/event state is changed.
