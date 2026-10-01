# Contract finance queue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: shared ListPage adoption for staff cancellation requests, contract refund obligations and second-approval requests, including linked approval reads.

Other list adoption, legacy filter URL serialization and broader search/sort remain open, keeping the all-list parent partial. This batch improves existing decision queues; it does not mark cancellation/refund/approval domain requirements newly complete. The primary contracts workspace already uses ListPage and is unchanged.

## Behavior and review

Cancellation request recovery retains accepted rows and the mounted contract detail, including its staff explanation. Local retry uses the exact failed cursor and service scope. Repeatedly opening the same contract keeps its detail callback usable. Switching service scope clears selected detail and abandons older reads and callbacks.

Refund recovery retains bank reference drafts and financial confirmation. Exact cursor retry updates duplicate obligations once with fresh eligibility; explicit Refresh returns to the first page without erasing bank references. Fresh obligation changes close obsolete confirmation. Refund commands wait for successful reads and current eligibility. Successful commands clear only their own reference draft. Existing automatic wallet retries, exhausted manual retries and separate bank transfer/reconciliation remain.

Approval recovery retains accepted rows, rejection reasons and financial review. Local retry uses the exact status/offset or linked request ID. Filters and draft text remain usable during read recovery; decision buttons wait for valid data. Filter changes hide older rows immediately and abandon obsolete responses. Changing a linked request remounts its work. Fresh request changes close obsolete confirmation; unchanged recovery retains it. Successful decisions clear only their own reason.

Permission denial clears retained rows, detail, references, reasons and confirmation. Generation-bound detail/completion callbacks cannot reload obsolete work or erase new authorized drafts. Unauthorized embedded cancellation/refund widgets retain their existing hidden behavior. The approval page shows a distinct bilingual read-permission message. Server command guards, exact amounts, step-up and approval rules remain unchanged.

No API, database, permission-model, dependency, scheduler or CI changes are included.

## Validation

Evidence logs: `/tmp/barghsa-contract-finance-*.log`.

The final web regression passes all 1,275 tests in 126 files. The related run passes all 409 tests in four files, including thirteen new recovery cases, refund/cancellation regressions and approval boundary checks. All 53 dictionary tests pass.

The final production-browser run passes all forty cases without failures or retries: twelve new bilingual recovery cases and 28 related approval, refund and customer cancellation cases across Chromium and mobile Safari. Accessibility and mobile overflow assertions pass for each new case. Persian mobile cancellation, refund and approval rendering is inspected.

Root build/typecheck/lint, contract and suppressed-error checks and all 64 route budgets pass. Final targeted lint/typecheck, root formatting and backlog/diff validation pass.

Earlier runs failed or were interrupted during severe host load/memory pressure. The goal resumed after host resources recovered. The final browser run uses the existing production static-server harness and one worker. A missing cancellation-status permission mock and ambiguous approval success/loading selectors are corrected; the mobile viewport is configured at context creation. The older refund fixture now uses authenticated staff and persisted locale. The legacy queue-error assertions are updated to the new resource-specific messages. Failed, interrupted and repeated cases are excluded from final passing totals.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/components/contract-finance-list-recovery.test.tsx src/components/ContractRefundQueue.test.tsx src/components/ContractCancellationRequestPanel.test.tsx src/pages/admin-boundaries.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs contract-finance-list-recovery.spec.ts approval-queue.spec.ts contract-refund-queue.spec.ts customer-cancellation-request.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Final targeted ESLint/Prettier checks cover edited source, tests and progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding electricity change batch is published as `4f6923750381f4a10f5ab3da9de8edf17809d6c0`; CI run `36791662796` passes all five gates under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This contract finance batch is committed and pushed directly to main after review and related checks. Its remote commit and CI are read back after publication. No PR is created. Other list adoption, legacy filter URL serialization and broader search/sort remain open, keeping the all-list parent partial.
