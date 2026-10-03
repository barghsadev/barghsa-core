# Financial approval threshold form — October 3, 2026

## Scope

This manual batch adopts shared validation, owned server-field feedback, retained drafts and submission locking for the dual-approval threshold editor together. It advances `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` on this surface. These global tasks remain partial. Wallet invoice allocation, emergency confirmation, approval-queue reasons and other staff editors remain open. The financial threshold domain was already implemented and is not counted again.

The editor retains raw localized IRR input in React Hook Form and reuses the existing whole-number, safe-integer and zero-disables rules through Zod Mini. Validation follows first touch; invalid submission focuses the editable control. Submit locks before asynchronous validation and displays a spinner during validation/confirmation. The API exposes only the public `thresholdIrR` identifier for owned invalid input, before database work. Root or mixed invalid input stays generic; snake_case and camelCase input compatibility remains.

OTP confirmation captures the exact numeric command. An acknowledgement must contain that same valid amount before showing success or normalizing the draft. Owned field errors close confirmation, retain raw input and return focus; mixed/protected errors and service failures retain the captured dialog for retry. Permission denial clears private work. Cancelled or replaced workspace callbacks cannot affect a new proposal. Transaction locks, current staff permission, OTP proof, version/cache updates, audit writes and rollback behavior remain.

No dependency or migration is added. Deploy additive API field metadata with or before the frontend; older API responses retain generic error recovery.

## Review and validation

Production validation identifies feedback moving the Save button during blur and field-error recovery, interrupting pointer submission. The editor reserves the localized feedback's full responsive height while keeping inactive text out of the accessibility tree. The shared focus hook and its existing touched-error regression remain unchanged. Existing form adapters and receipt rejection are included in browser verification to confirm the original mechanisms still work.

- Related unit/integration validation passes **247 distinct cases**, including **43 new cases**: API 129/129 across threshold service/controller and migrated HTTP transactions; web 57/57 across threshold, queue navigation, finance recovery and action-dialog behavior; shared threshold rules 14/14; existing UI form/binding/step components 47/47. The final affected threshold suite passes 32/32. Repeated runs and the discarded duplicate UI test are excluded.
- Production browser verification passes **52/52** scenarios in 51.2 seconds across threshold, existing receipt rejection and all form adapters on Chromium/mobile Safari. Twelve new threshold scenarios cover both languages/themes, OTP, owned/mixed field errors, service failure, mismatched acknowledgement, exact retry bodies and denial. Linked feedback, invalid-submit and return focus, unchanged Save position on blur, RTL, mobile bounds and scoped Axe pass. Persian dark mobile feedback is visually inspected.
- Final root build passes 7/7 tasks; type checking passes 11/11 packages. Zero-warning lint and all **74 unchanged budgets** pass. Strict SAST passes five fixtures and scans **1,528 files with zero findings or scanner errors**. Contract/suppression, root formatting and backlog/diff checks pass. The backlog validates 1,355 tasks and 116 traceability entries.

The first web run contains test-fixture failures: array table rows spread metadata arguments, and focus was asserted before deferred recovery. The corrected tables and waiting assertions pass. The first browser run passes eight cases and fails twelve: four expose interrupted submission; eight stop at background-role locators that correctly disappear from the accessibility tree while confirmation is open. Tests now query those retained controls by ID or explicitly include hidden background roles, preserving focus and validation assertions. An initial shared-hook diagnosis is disproved by the original hook's passing regressions; that proposed change and duplicate test are removed. The subsequent production run passes 44 and fails eight, isolating feedback layout movement during initial submission and field-error retry. Reserving feedback height fixes all eight; the final 52-case run passes. No timeout, test gate or budget is weakened.

Exact commands:

```sh
pnpm --filter @barghsa/api test src/admin/dual-approval-threshold-config.service.test.ts src/admin/dual-approval-threshold-config.controller.test.ts src/admin/dual-approval-http.integration.test.ts
pnpm --filter @barghsa/web test src/components/DualApprovalThresholdPanel.test.tsx src/pages/decision-queue-navigation.test.tsx src/components/contract-finance-list-recovery.test.tsx src/components/TeamActionDialog.multipart.test.tsx
pnpm --filter @barghsa/shared exec vitest run src/finance/dual-approval-config.test.ts
pnpm --filter @barghsa/ui test src/form
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e approval-threshold.spec.ts staff-receipt-rejection-forms.spec.ts form-fields-component.spec.ts --project=chromium --project=mobile-safari --workers=2
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:bundle
pnpm check:contract
pnpm check:suppressed-errors
python3 scripts/check-sast.py --report /tmp/barghsa-threshold-forms-sast-reviewed.json
python3 kanban/scripts/build_backlog.py --check
git diff --check
```

## Publication and continuation

This batch is published with a conventional commit and normal direct push to `main`. Local/origin/advertised/GitHub SHA agreement, clean checkout and exact-commit CI registration are read back after publication. No PR, scheduler, external supervisor state, generated queue or historical completion/event state is changed. Remote CI confirmation remains separate from local validation.
