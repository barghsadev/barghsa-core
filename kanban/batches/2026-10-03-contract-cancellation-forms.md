# Contract cancellation forms — October 3, 2026

## Scope

This manual batch adopts shared form validation and recovery across customer cancellation requests, staff request rejection and staff cancellation/refund decisions together. It advances `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` on these forms. These global tasks remain partial. Refund editors and other forms still require adoption; existing cancellation business functionality is not counted again.

React Hook Form with deferred Zod Mini validates reasons, destination preferences and exact whole-IRR custom refunds after touch and on submission. Custom amounts range from zero to each invoice's available balance; zero rows are omitted from the captured command. Full-wallet decisions ignore hidden custom amounts. Linked localized feedback reserves its complete responsive height, returns focus to invalid fields and preserves raw drafts through correction, unchanged refreshes and failed reads. An unavailable validation module blocks submission with a localized page-refresh instruction.

The API returns only owned public field identifiers. Customer feedback requires the same live profile/session, contract ownership and requestability checks as submission. Staff authorization precedes field metadata. Indexed refund feedback maps through the captured positive-refund command to invoice IDs, rather than through the current display order. Protected, root and mixed failures stay generic. Invalid input creates no cancellation request, rejection or intent.

Submission ownership prevents duplicate or competing commands during validation and confirmation. Retries retain the exact version, fingerprint, request binding, refund decision and idempotency key. Read failures disable new commands and confirmation until recovery; explicit denial clears private data and drafts. Scope changes and obsolete callbacks cannot restore old work. A success acknowledgement must match the captured request or financial decision before the form clears or reports success.

Existing permissions, password/OTP verification, second-reviewer requirements, immutable financial decisions, cancellation execution, refund obligations, transactions and audits remain. Service cancellation and refund completion remain separate states. The staff decision editor loads when opened; cancellation validation and the shared financial-review parser also load on interaction. Existing acceptance/signature review behavior is retained. Two new interaction budgets cover the editor and cancellation validation; all 74 existing limits remain unchanged.

No dependency, migration or financial-service rewrite is added. Deploy additive API field metadata with or before the frontend; older responses retain generic correction/retry. No PR, scheduler, external supervisor state, generated queue or historical completion/event state is changed.

## Review and validation

- **664 distinct related unit/integration cases** have passing evidence, including **58 additional cases**. API cancellation metadata, migrated request/command HTTP and snapshot tests cover 72 cases. Web cancellation forms, financial review, contract/signature workspaces, finance recovery, administrator boundaries, queue navigation and action-dialog tests cover 524 cases. Dictionaries pass 68/68. The final affected financial-review run passes 14/14; the final cancellation/regression run passes 459/459. Repeated runs are excluded.
- Real HTTP tests verify customer ownership, live step-up, staff permission, owned/indexed versus protected/mixed errors and absence of failed-input writes. Existing tests retain cancellation transaction, request binding and immutable financial decision coverage.
- **52/52 final production browser scenarios** pass in 2.6 minutes on Chromium and mobile Safari, including 28 new cases. Both languages/themes, linked focus, retained drafts, exact retries, duplicate submission, owned/mixed errors, service failures, mismatched acknowledgements, denial/recovery, missing validator, custom BigInt bounds, zero-filtered refund mapping, RTL, scoped Axe and mobile bounds pass. Existing acceptance/signature and complete request/cancellation flows pass. Persian dark mobile rendering is inspected. Browser APIs are mocked; migrated HTTP tests verify real transactions separately.
- Root build passes 7/7 tasks; type checking passes 11/11 packages. Zero-warning lint and **76/76 budgets** pass. Validation costs 14.09 KB / 20 KB; the staff editor costs 106.89 KB / 120 KB; contract detail costs 223.60 KB / its unchanged 250 KB limit. All 74 existing thresholds remain unchanged.
- Strict SAST passes five fixtures and scans **1,535 files with zero findings or scanner errors**. OpenAPI consistency and suppression checks pass. Formatting, backlog and staged diff checks run before publication. The backlog validates 1,355 tasks and 116 traceability entries.

Review corrects outdated browser acknowledgement fixtures and asynchronous unit assertions. Intermediate Safari timeouts occurred under local memory pressure; the final browser run uses one worker and runs separately from builds/scans. The missing-validator test now aborts the manifest's actual chunk. Deferred editor/validation/parser imports resolve the contract-detail budget failure. No timeout, validation gate or existing budget is weakened.

Exact validation commands:

```sh
pnpm --filter @barghsa/api test src/contract/contract-cancellation-input-fields.test.ts src/contract/contract-cancellation-request-http.integration.test.ts src/contract/contract-cancellation-http.integration.test.ts src/contract/contract-cancellation-snapshot.test.ts
pnpm --filter @barghsa/web test src/components/ContractCancellationPanel.test.tsx src/components/ContractCancellationRequestPanel.test.tsx src/components/contract-finance-list-recovery.test.tsx src/pages/decision-queue-navigation.test.tsx src/pages/admin-boundaries.test.tsx src/components/TeamActionDialog.multipart.test.tsx --maxWorkers=1 --no-file-parallelism
pnpm --filter @barghsa/web test src/components/ContractsWorkspace.test.tsx src/components/ContractFinancialReviewDialog.test.tsx src/components/ContractSignaturePanel.test.tsx --maxWorkers=1 --no-file-parallelism
pnpm --filter @barghsa/web test src/components/ContractFinancialReviewDialog.test.tsx --maxWorkers=1
pnpm --filter @barghsa/i18n test
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e cancellation-forms.spec.ts contract-cancellation.spec.ts customer-cancellation-request.spec.ts contracts.spec.ts contract-signatures.spec.ts --project=chromium --project=mobile-safari --workers=1
pnpm build --concurrency=1
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:bundle
pnpm check:contract
pnpm check:suppressed-errors
python3 scripts/check-sast.py --report /tmp/barghsa-cancellation-sast-publish.json
python3 kanban/scripts/build_backlog.py --check
git diff --cached --check
```

## Publication and continuation

This batch uses a conventional commit and normal direct push to `main`. Local, origin, advertised remote and GitHub SHA agreement, clean checkout and exact-commit CI registration are read back after publication. New remote CI remains separate from local validation.

The next related batch covers the contract refund queue and refund decision editors. The preceding approval batch's CI run [37125964403](https://github.com/barghsadev/barghsa-core/actions/runs/37125964403), for `6883b63fa1190043eb5e4449f9de006262ec5008`, passes all five gates. No global form task is marked complete by this batch.
