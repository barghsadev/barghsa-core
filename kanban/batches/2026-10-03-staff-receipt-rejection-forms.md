# Staff receipt rejection forms — October 3, 2026

## Scope and behavior

This manual batch adopts shared form state across wallet and invoice bank-receipt rejection together. It advances `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` for these two editors. The global criteria remain open: other staff forms, wallet invoice allocation and emergency-reason inputs still need adoption. The underlying rejection and settlement domain requirements were already built and are not counted as new completed tasks.

Both rejection editors retain raw drafts in React Hook Form, reuse their existing shared reason parsers through Zod Mini and validate on blur/change after first touch. Blank, oversized and disallowed control-character reasons receive localized linked feedback. Invalid submission focuses the reason. Submission locks before asynchronous validation; a spinner, disabled controls and captured-action ownership guard duplicate or obsolete work. Changing receipt scope resets its form state. Existing queue/view retries retain the draft.

Both APIs return only the public `reason` identifier through the existing field exception for malformed rejection input, before financial locking. Authorization, password verification, exact financial reviews, database transactions, notification/audit writes and balance behavior remain. No migration or dependency is added. Deploy the additive API metadata with or before the frontend; older API responses retain generic failure recovery.

Wallet writes map only owned reason metadata to localized feedback. Other failures use a top-of-form Alert with local copy. Explicit session/permission denial clears private work; other policy failures remain available for correction. Invoice confirmation closes on an owned reason failure and returns focus to the retained editor. Protected, mixed or empty metadata remains generic. Network/service failures retain captured reasons and permit retry. Neither frontend renders server diagnostic text.

## Review and validation

- Related API validation passes **128/128** cases across both confirmation services/controllers, wallet transaction integration and invoice rejection integration. Ten malformed-reason cases check safe identifiers and no database connection or wallet credit before validation; eight of these are additional cases. Existing integration covers stored reasons, unchanged balances, idempotent retry, audit/notification atomicity and rollback.
- Related web validation has passing evidence for **98 distinct cases**, including **15 new** cases. The final wallet suite passes 49/49 and invoice suite 22/22; the other 27 cases pass in the related recovery/navigation/dialog run. Tests cover touched correction, invalid text retention, server metadata ownership, linked focus, duplicate submission, spinner/locking, network recovery, explicit denial and obsolete selection. Repeated runs are excluded from the count.
- Dictionaries pass **68/68** cases. Total staff form evidence is **294 distinct cases**, with 23 additional cases. The CI repair below adds passing evidence for 24 existing parent-page cases, bringing this batch to **318 distinct related unit/integration cases**.
- Production browser validation passes **38/38** scenarios in 1.4 minutes across Chromium and mobile Safari, including **16 new** bilingual/light/dark recovery flows. They exercise invalid submission, touched correction, password verification, owned-field rejection, mixed protected metadata, service failure and exact captured retry bodies through success. Existing review/allocation and table/card/history flows also pass. Scoped Axe checks and mobile bounds pass. Persian dark mobile feedback is visually inspected; the two affected flows pass again for viewport screenshots, without adding them to the distinct count.
- Root build passes all seven tasks; type checking passes all eleven packages. Zero-warning lint, formatting, contract/suppression and backlog/diff checks pass. All **74 unchanged budgets** pass; wallet staff initialization is **427.46 KB / 500 KB**. Strict SAST passes five rule fixtures and scans **1,527 files with zero findings or scanner errors**. No broad unrelated unit suite is rerun.
- Final wallet field-failure verification also checks that the valid invoice-allocation ID survives reason/metadata failures. All three affected cases pass; repeated cases are excluded from the total.

Exact related commands:

```sh
pnpm --filter @barghsa/api test src/wallet/bank-receipt-confirmation.service.test.ts src/wallet/bank-receipt-confirmation.integration.test.ts src/admin/bank-receipt-confirmation.controller.test.ts src/invoice/invoice-bank-receipt-confirmation.service.test.ts src/invoice/invoice-bank-receipt-rejection.integration.test.ts src/admin/invoice-bank-receipt-confirmation.controller.test.ts
pnpm --filter @barghsa/web test src/pages/AdminWalletReceiptsPage.test.tsx src/components/InvoiceBankReceiptQueue.test.tsx src/pages/payment-review-recovery.test.tsx src/pages/decision-queue-navigation.test.tsx src/components/TeamActionDialog.multipart.test.tsx
pnpm --filter @barghsa/web test src/pages/AdminWalletReceiptsPage.test.tsx
pnpm --filter @barghsa/web test src/components/InvoiceBankReceiptQueue.test.tsx
pnpm --filter @barghsa/web test src/pages/AdminWalletReceiptsPage.test.tsx -t "retains draft and localizes server validation fields"
pnpm --filter @barghsa/web test src/pages/InvoiceDetailsPage.test.tsx
pnpm --filter @barghsa/i18n test
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e staff-receipt-rejection-forms.spec.ts bank-receipt-review.spec.ts staff-wallet-receipt-views.spec.ts staff-invoice-receipt-views.spec.ts --project=chromium --project=mobile-safari --workers=2
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:bundle
pnpm check:contract
pnpm check:suppressed-errors
python3 scripts/check-sast.py --report /tmp/barghsa-staff-rejection-sast-final.json
python3 kanban/scripts/build_backlog.py --check
git diff --check
```

Intermediate failures are retained in the validation logs and excluded from passing totals. A wrong dictionary export and an unavailable test-helper import were corrected without adding dependencies. Tests identified an incorrect metadata-reader argument order that lost wallet inline feedback; the final field/focus regression passes. Explicit permission denial was narrowed to recognized authorization failures so unknown policy failures retain the existing correction behavior. Generic-message assertions were updated to the owning dictionary. TypeScript required an explicit hook return type; the final root type check passes. Review removes a duplicate form reset and clears rejection state on queue denial. No test, timeout, gate or budget is weakened.

## Previous payment CI repair

The preceding payment commit's [CI run37121830769](https://github.com/barghsadev/barghsa-core/actions/runs/37121830769) finishes with two failing `InvoiceDetailsPage.test.tsx` assertions. The parent tests still expect the removed global invalid-amount banner after the child form adopted field feedback. They are consolidated into two exact-amount cases, using native React input updates and waiting for deferred validation. Assertions now verify the linked amount error and focus, retained invalid amount and valid date/reference, and no receipt or upload POST. All **24 parent-page cases pass**. This repairs test expectations without reverting inline validation or relaxing a gate. Static security, secrets and integrity pass in the old run; tests and downstream combined coverage fail. The repaired commit's remote CI must still confirm success after publication.

## Publication and continuation

This batch is published with a conventional commit and a normal direct push to `main`, as authorized for manual batches. Local/origin/advertised/GitHub SHA agreement, clean checkout and exact-commit CI registration are read back after push. Remote CI confirmation remains pending. No PR, scheduler, external supervisor state, generated queue or historical completion/event state is changed.
