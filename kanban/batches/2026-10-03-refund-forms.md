# Refund forms and queue reviews, October 3, 2026

## Scope

This batch adopts shared validation and failure recovery across wallet and bank refund requests, staff refund decisions and the contract refund queue. It advances `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06`. These global tasks remain partial because other forms still require adoption.

React Hook Form and deferred Zod Mini validate invoice lookup, exact whole-IRR amounts, reasons and bank references after touch and on submission. Persian and Arabic digits remain in the draft; commands capture canonical amounts and trimmed strings. Each decision validates its selected input. Approval and processing ignore companion rejection drafts; reconciliation requires the recorded bank reference. Linked localized errors reserve their full responsive height and return focus without clearing companion fields.

The API authorizes the caller before returning public field identifiers. It exposes only amount, reason or bank-reference errors owned by the selected form. Protected hashes, invoice IDs, unknown fields and mixed failures remain generic. Confirmation retains existing live step-up, permissions, second-reviewer requirements, financial transactions, audit writes and retry behavior. Invalid input creates no refund or financial write.

The contract refund queue previously submitted commands without the required financial review hash. It now obtains and checks an authoritative review, displays its financial summary and binds confirmation to that captured hash. Request and decision editors also wait for the summary module before offering confirmation. A delayed or failed summary load cannot expose a confirmation command.

Submission ownership blocks duplicate and competing actions. Drafts survive failed reads, unchanged refreshes, pagination, ordinary confirmation dismissal and correction. Changed financial snapshots invalidate old confirmations. Explicit denial clears private work; obsolete callbacks cannot restore it. Changed lookup text disables commands for the previously loaded invoice until the lookup matches again. A matching acknowledgement is required before clearing the selected draft. Wallet processing and bank transfer remain separate from completed refund reconciliation.

Staff can open the refund workspace from the invoice page or select an invoice in the ledger. Invoice deep links open it directly. The workspace loads only on those paths; review summaries and validation also load when needed. A narrow shared refund-parser entry avoids pulling unrelated financial schemas into the deferred workspace. Three new interaction budgets cover the workspace, summary and form validation. All 76 existing limits remain unchanged; the parser remains included in the workspace and applicable route measurements.

Deploy additive API field metadata with or before the frontend. Older API errors retain generic correction and retry. No dependency or migration is added. This manual batch uses direct-main publication and leaves scheduler, generated queue and historical supervisor state unchanged.

## Review and validation

- **557 distinct related unit/integration cases** have passing evidence, including **39 additional cases**. Refund input and migrated wallet/bank HTTP tests cover 58 cases. Web forms, queue/recovery, administrator boundaries, queue navigation, action dialogs and the invoice parent page cover 431 cases. Dictionaries pass 68/68. Repeated runs are excluded.
- Real HTTP tests cover authorization before metadata, owned versus protected/mixed errors, live step-up, absence of failed-input writes and existing wallet/bank refund transactions. The new parser entry works in both ESM and CommonJS builds.
- **44 distinct production browser scenarios** have passing evidence, including 32 new cases. The complete 44/44 run passes in 1.5 minutes; the final affected 12/12 run passes after the workspace-entry change. It verifies both invoice deep links and manual opening, including absence of a workspace chunk request before opening. The other 32 scenarios retain preceding passing evidence. Chromium and mobile Safari cover both languages/themes, RTL, linked focus, raw drafts, captured retries, owned/mixed errors, service failures, mismatched acknowledgements, unavailable validation, delayed/failed summary loads, bank reconciliation and existing complete refund flows. Scoped Axe and mobile bounds pass. Persian dark mobile rendering is inspected. Browser APIs are mocked; migrated HTTP tests verify real transactions separately.
- Root build passes 7/7 tasks; type checking passes 11/11 tasks. Zero-warning lint and **79/79 bundle budgets** pass. The refund workspace measures 127.57 KB / 160 KB, its summary 14.35 KB / 60 KB and validation 14.37 KB / 20 KB. Existing customer validation measures 17.89 KB / 20 KB; the invoice route measures 495.56 KB / its unchanged 500 KB limit.
- Strict SAST passes five fixtures and scans **1,545 files with zero findings or scanner errors**. OpenAPI consistency and suppression checks pass. Formatting, backlog and staged diff checks run before publication. The backlog validates 1,355 tasks and 116 traceability entries.

Review fixes the missing queue hash, blocks confirmation before the summary loads and makes workspace deferral correspond to actual activation. It also corrects stale acknowledgement fixtures, async unit assertions and the shared fixture location. Checks caught a missing loading import during development. Narrow parser imports and real workspace deferral resolve the original customer-validation and invoice-route size failures. No test timeout, validation gate or existing budget is weakened.

Exact validation commands:

```sh
pnpm --filter @barghsa/api test src/refund/refund-input-fields.test.ts src/refund/wallet-refund-http.integration.test.ts src/refund/external-refund-http.integration.test.ts
pnpm --filter @barghsa/api test src/refund/external-refund-http.integration.test.ts
pnpm --filter @barghsa/web test src/components/RefundPanel.test.tsx src/components/ContractRefundQueue.test.tsx src/components/contract-finance-list-recovery.test.tsx src/pages/admin-boundaries.test.tsx src/pages/decision-queue-navigation.test.tsx src/components/TeamActionDialog.multipart.test.tsx --maxWorkers=1 --no-file-parallelism
pnpm --filter @barghsa/web test src/pages/AdminInvoicesPage.test.tsx --maxWorkers=1
pnpm --filter @barghsa/i18n test
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e refund-forms.spec.ts manual-wallet-refund.spec.ts manual-external-refund.spec.ts contract-refund-queue.spec.ts --project=chromium --project=mobile-safari --workers=1
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e refund-forms.spec.ts --grep "confirmation waits|refund request retains" --project=chromium --project=mobile-safari --workers=1
pnpm build --concurrency=1
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:bundle
pnpm check:contract
pnpm check:suppressed-errors
python3 scripts/check-sast.py --report /tmp/barghsa-refund-sast-final.json
python3 kanban/scripts/build_backlog.py --check
git diff --cached --check
```

## Publication and continuation

This batch uses a conventional commit and normal direct push to `main`. Local, origin, advertised remote and GitHub SHA agreement, clean checkout and exact-commit CI registration are read back after publication. New remote CI remains separate from local validation.

The preceding cancellation batch's CI run [37134854672](https://github.com/barghsadev/barghsa-core/actions/runs/37134854672), for `12aec688d70f59235bfb5b21ede3792f7886145c`, passes all five gates. The next related batch covers staff invoice and correction editors. No global form task is marked complete by this batch.
