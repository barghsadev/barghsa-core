# Staff invoice and correction forms, October 3, 2026

## Scope

This batch adopts shared validation and recovery across manual invoice creation, unpaid invoice replacement, signed adjustments after payment and correction lookup. It advances `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06`. These global tasks remain partial because other forms still require adoption.

React Hook Form and deferred Zod Mini validate customer selection, descriptions, quantities, whole-IRR prices, VAT, correction reasons, signed amounts and invoice lookup after touch and on submission. Invalid submission shows linked localized feedback and focuses an editable field. Aggregate validation covers 1–100 lines, positive totals and the supported IRR range. Raw Persian/Arabic digits, spacing and companion values remain in the draft; only captured commands normalize them.

Dynamic lines retain UUID identities through reordering and removal. Server indexes map through the captured row order, so feedback stays attached to the correct row. The API authorizes the caller before exposing owned field identifiers. Hashes, request keys, source identities, unknown fields and mixed errors remain generic. Invalid input produces no invoice or correction write. Malformed adjustment preview amounts now return a validation error instead of reaching `BigInt()` and throwing a server error.

Synchronous ownership blocks duplicate submissions before deferred validation loads. Inputs remain locked during review, verification and uncertain writes. Financial summaries and hashes must match captured scope, lines, reasons and amounts before confirmation. An uncertain result retains the exact command and key for retry. A confirmation must match the captured total; manual acknowledgements reject draft or unknown states but accept supported issued states, because a replayed invoice may already have advanced through payment, cancellation or refund. Existing live permissions, step-up, second review, transactions and audits remain.

Failed unchanged customer/source reads retain drafts while blocking commands until recovery. Successful unchanged reloads retain drafts. Changed correction identity, profile or kind creates a fresh editor; changed source facts invalidate an obsolete review. Explicit denial clears private work, and obsolete review callbacks cannot restore it. Ordinary validation or review failure keeps companion values.

The editor opens only after New manual invoice or a valid correction lookup. Validation and narrow shared invoice-review parsers load when needed. Two new interaction budgets cover the editor and validator. The editor measurement includes its complete manifest dependency graph, including shared modules already on the invoice page. All 79 existing budgets retain their prior definitions and limits.

Deploy additive API field metadata with or before the frontend. Older API errors retain generic feedback and correction. No dependency or migration is added. Scheduler, generated queue, historical loop state and external supervisor/handoff state remain unchanged.

## Review and validation

- **568 distinct related unit/integration cases pass**, including **40 additional cases** across this work and its CI repair. Invoice input and real HTTP tests pass 57/57; web editor, pagination, administrator-boundary and invoice parent tests pass 408/408; dictionaries pass 68/68; shared review tests pass 2/2. The accompanying onboarding CI repair passes 33/33 HTTP cases. The final API run passes all 90 invoice/onboarding cases together. Repeated runs and build/checker fixtures are excluded from this total.
- **52/52 final production browser scenarios pass in 2.1 minutes**, including 20 new cases. Chromium and mobile Safari cover Persian/English, actual light/dark themes, RTL, linked focus, reordered feedback, retained drafts, failed-read recovery, changed scope, denial, corrected issuance, missing validators and existing issuance/replacement/adjustment/approval/step-up/retry flows. The editor chunk is absent before opening. Scoped Axe, contrast completeness and mobile bounds pass. Persian dark mobile rendering is inspected. Browser APIs are mocked; migrated real HTTP tests verify financial writes separately.
- Root build passes 7/7 tasks; type checking passes 11/11 tasks; zero-warning lint passes. **81/81 bundle budgets** pass. Editor: 229.79 KB / 250 KB; validator: 15.02 KB / 20 KB; existing customer validator: 17.89 KB / 20 KB; invoice route: 491.50 KB / its unchanged 500 KB limit. All 33 prior budget definitions, which expand to 79 measurements, compare unchanged. The new editor budget is based on its measured full dependency graph; the initial 160 KB estimate did not account for that graph.
- The narrow invoice-parser entry resolves in both ESM and CommonJS builds and retains the original financial validators. Strict SAST passes five fixtures and scans **1,553 files with zero findings or scanner errors**. OpenAPI and suppression checks pass. Formatting, backlog and staged diff checks run before publication. The canonical backlog validates 1,355 tasks and 116 traceability entries.

Review fixes guarded adjustment parsing, acknowledgement total/state handling, aggregate-error placement and deferred dependency loading. It preserves legitimate replay states after inspecting the service's readback behavior. Tests caught an already-revoked shared session, asynchronous dialog assertions and incorrect native-fieldset disabled checks; those fixtures/assertions are corrected without increasing timeouts. Browser fixtures now provide a valid branding configuration and assert the actual theme, rather than trusting a scenario label. Narrow parser loading resolves the existing customer-validator size regression. No existing test or budget gate is disabled or raised.

Exact validation commands:

```sh
pnpm --filter @barghsa/api test src/invoice/invoice-input-fields.test.ts src/invoice/manual-invoice-http.integration.test.ts src/invoice/invoice-corrections-http.integration.test.ts src/profiles/onboarding-journeys-http.integration.test.ts
pnpm --filter @barghsa/web test src/components/ManualInvoiceForm.test.tsx src/components/ManualInvoicePanel.pagination.test.tsx src/pages/admin-boundaries.test.tsx src/pages/AdminInvoicesPage.test.tsx --maxWorkers=1 --no-file-parallelism
pnpm --filter @barghsa/i18n test
pnpm --filter @barghsa/shared exec vitest run src/finance/manual-invoice-review.test.ts
BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e e2e/invoice-forms.spec.ts e2e/manual-invoice.spec.ts e2e/invoice-corrections.spec.ts --project=chromium --project=mobile-safari --workers=1
pnpm build --concurrency=1
pnpm typecheck
pnpm lint
pnpm check:bundle
node --test scripts/check-openapi.test.mjs
node scripts/check-openapi.mjs
pnpm check:suppressed-errors
python3 scripts/check-sast.py --report /tmp/barghsa-invoice-sast-final.json
pnpm format:check
python3 kanban/scripts/build_backlog.py --check
git diff --cached --check
```

## Publication and continuation

The preceding refund batch's [CI run 37137503457](https://github.com/barghsadev/barghsa-core/actions/runs/37137503457) failed one onboarding concurrency assertion and its dependent gate. It is not recorded as success. The [separate CI repair](2026-10-03-onboarding-concurrency-ci.md), committed as `336fb6ac`, verifies the durable winner for both request orders without relaxing profile, journey, replay or audit checks.

That repair and this conventional feature commit use one normal direct push to main. Local, origin, advertised remote and GitHub SHA agreement, clean checkout and exact-head CI registration are read back after publication. The new remote CI result remains separate from local validation.

The next related batch covers staff due-date overrides and financial configuration forms. Global form adoption remains open; this batch does not mark those tasks or the full build goal complete.
