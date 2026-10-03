# Wallet allocation and emergency-confirmation forms — October 3, 2026

## Scope

This manual batch adopts shared validation, owned server-field feedback, retained drafts and submission locking for wallet invoice allocation and emergency confirmation together. It advances `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` on these surfaces. These global tasks remain partial; approval-queue reasons and other staff editors remain open. Existing financial settlement and dual approval are not counted again.

Separate React Hook Form/Zod Mini drafts retain the raw optional invoice UUID and required emergency reason. Existing domain bounds apply. Touched validation and invalid submission provide linked localized feedback and focus. Valid invoice commands use canonical lowercase UUIDs while preserving the entered text; emergency commands trim the captured reason. A dual-approval invoice remains read-only. Validation locks before asynchronous submission, and confirmation displays a spinner through writes and password verification.

The API returns only public owned `invoiceId` or `emergencyOverrideReason` identifiers after authorization and before finance service work. Protected review hashes, unknown properties and mixed errors remain generic. The UI maps only editable fields belonging to the submitted form. Owned failures close password confirmation, retain all companion drafts and return focus; generic failures retain correction/retry. Explicit denial clears private work. Selection, review and workspace generations reject obsolete responses and duplicate commands.

The displayed financial review and its exact hash still govern writes. Allocation limits, current permissions, password/OTP proof, transactions, locking, idempotency, audits and rollback behavior remain covered. No dependency, migration or financial-service change is added. Deploy additive API field metadata with or before the frontend; older responses retain generic recovery.

## Review and validation

Review fixes dark-theme contrast in the pending dual-approval notice. Production pointer checks also expose invoice blur clearing a server field error, revealing a generic banner and moving Refresh before mouseup. A failed financial-review field error now survives a successful local blur check until the invoice changes or a fresh review succeeds. The feedback reserves its localized responsive height. Shared form/focus hooks remain unchanged.

- Related unit/integration validation has passing evidence for **366 distinct cases**, including **34 additional cases**: API 190/190 across receipt controller/service, migrated settlement and dual-approval HTTP integration; web 108/108 across wallet receipts, financial recovery, queue navigation and invoice receipt operations; dictionaries 68/68. The final controller suite passes 30/30 and final four-file web run passes 108/108. Repeated runs are excluded.
- **58 distinct production browser scenarios** have passing evidence on Chromium and mobile Safari: 24 new allocation/emergency scenarios, four existing emergency scenarios, six financial-review scenarios, eight wallet-view scenarios and 16 rejection scenarios. The final affected **28/28** run passes in 30.2 seconds after the last fix; the other 30 regressions pass in the preceding run. Browser APIs are mocked, with real migrated financial transactions verified separately by API integration tests. Both languages/themes, password retry, owned/mixed errors, service recovery, exact five-attempt command bodies, denial, duplicate submissions, retained read-only invoices and companion drafts, linked feedback/focus, RTL, mobile bounds and scoped Axe are verified. Persian dark mobile feedback is visually inspected.
- Final root build passes 7/7 tasks and type checking passes 11/11 packages. Zero-warning lint and all **74 unchanged budgets** pass. Strict SAST passes five fixtures and scans **1,529 files with zero findings or scanner errors**. Contract/suppression checks pass; root formatting and backlog/diff checks are verified before publication. The backlog validates 1,355 tasks and 116 traceability entries.

An initial web run finds a stale expectation for a raw server message; the replacement verifies localized feedback and retained invoice input. A query table fixture is corrected to exercise array input rather than spread its elements. The first browser run passes 44 and fails 14: four old emergency fixtures lack the authenticated shell, eight allocation assertions change the server fixture before the first review is observed, and two dark-theme checks expose insufficient notice contrast. Shell setup, request synchronization and contrast are corrected without weakening assertions. The next run passes 48 and fails ten: two desktop emergency locators assume the old card layout, and eight allocation scenarios expose interrupted Refresh clicks. Locators now cover both table and card selection controls; retained review feedback fixes the pointer issue. Final affected verification passes all 28 scenarios. No timeout, test gate or budget is weakened.

Exact commands:

```sh
pnpm --filter @barghsa/api test src/admin/bank-receipt-confirmation.controller.test.ts src/wallet/bank-receipt-confirmation.service.test.ts src/wallet/bank-receipt-confirmation.integration.test.ts src/admin/dual-approval-http.integration.test.ts
pnpm --filter @barghsa/api test src/admin/bank-receipt-confirmation.controller.test.ts
pnpm --filter @barghsa/web test src/pages/AdminWalletReceiptsPage.test.tsx src/pages/payment-review-recovery.test.tsx src/pages/decision-queue-navigation.test.tsx src/components/InvoiceBankReceiptQueue.test.tsx
pnpm --filter @barghsa/i18n test
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e wallet-confirmation-forms.spec.ts receipt-emergency.spec.ts bank-receipt-review.spec.ts staff-wallet-receipt-views.spec.ts staff-receipt-rejection-forms.spec.ts --project=chromium --project=mobile-safari --workers=2
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e wallet-confirmation-forms.spec.ts receipt-emergency.spec.ts --project=chromium --project=mobile-safari --workers=2
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:bundle
pnpm check:contract
pnpm check:suppressed-errors
python3 scripts/check-sast.py --report /tmp/barghsa-wallet-confirm-forms-sast-release.json
python3 kanban/scripts/build_backlog.py --check
git diff --check
```

## Publication and continuation

This batch is published with a conventional commit and normal direct push to `main`. Local/origin/advertised/GitHub SHA agreement, clean checkout and exact-commit CI registration are read back after publication. Remote CI confirmation remains separate from local validation. At the latest read, preceding threshold CI run `37123784342` has passing integrity, static-security and secret checks while tests remain running; superseded rejection run `37122847133` is cancelled, not passed.

Approval-queue reason forms are the next related adoption batch. No PR, scheduler, external supervisor state, generated queue or historical completion/event state is changed.
