# Electricity correction and resubmission forms — October 4, 2026

Status: built and independently reviewed; final local checks and direct-main publication are recorded separately.

## Kanban scope

This batch applies `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` across staff correction/rejection reasons, customer address correction and simple/advanced order revision. Domain context is `03-core-business.md#T-03.07.02.02`, `03-core-business.md#T-03.07.02.05`, `03-core-business.md#T-03.07.04.02` and `03-core-business.md#T-03.07.04.03`. Broader shared adoption and parent tasks remain open.

- Shared touched validation provides bilingual linked help/errors, invalid-control focus and preserved raw drafts. Staff reasons and customer response notes normalize to 1–1,000 characters; addresses and optional gift codes retain existing limits and postal validation. Staff approval remains reason-free.
- Controllers project only recognized editable field identifiers from an unambiguous form variant. Protected, mixed and structural errors remain generic and do not echo submitted values. Accepted request schemas, live grants, step-up requirements, pricing, mandatory-green policy, geography and date constraints remain unchanged.
- Staff decisions require a complete review matching the selected actor/profile/order, action, version, reason, contract and invoice. Receipts use the actual service fields, including refund identity where required. Customer address/full revision receipts require a new version; full revisions also require the replacement invoice and matching complete quote. Quote duration is a string, and semantic line comparison accepts durable JSONB key reordering.
- A synchronous shared customer lock prevents competing address/revision/cancellation commands. Captured writes freeze both editors and retain the original key, body, hash or digest for explicit exact retry. A detail read cannot prove an uncertain correction committed. Unclassified or malformed write responses retain uncertainty; a rejected retry cannot erase it.
- Actor, order, version and selection generations fence asynchronous reads, validation, previews and dialog callbacks. Advanced options must be ready before preview. Denied options/resources withdraw private forms. A staff missing-order response withdraws only its selected private detail while preserving authorized queue work and explicit recovery.
- Revision controls remain focusable during validation and read-only preview, while synchronous guards prevent duplicate requests. Editing a pending preview draft invalidates both its successful quote and owned error feedback. Authorization failures still withdraw private data before that freshness check.

## Review and corrections

Independent review repaired incomplete service-shape assumptions, JSONB comparison, stale callbacks that could borrow a new attempt, navigation escape from an uncertain command, incomplete rejection envelopes, advanced option readiness, date-trigger labeling and missing-resource recovery. Production browser testing exposed disabled-control focus timing; the bounded fix retains write locks while allowing focus during preview. Review then added stale-preview-error protection with a held-response regression.

Legacy fixtures now supply actual UUIDs, full reviews/quotes/receipts and the reason textarea while retaining their original financial and recovery assertions. Initial browser fixtures used an invalid rejection status, edited a previous selection before accepted detail arrived, and assumed quantity was the only invalid field. Repairs isolate each focus assertion and preserve every assertion. TypeScript repairs use typed mock procedures, actual parameterized field arrays and custom owned issue projection without casts. Initial failures and affected reruns remain external.

## Validation

**147 distinct related unit/API/dictionary cases and 20 distinct production browser cases have passing evidence**, excluding reruns.

- API controller projections — 68 pass. Ten selected live electricity HTTP cases have passing evidence across the initial run and one affected numeric-fixture rerun. They cover exact no-write storage/version/invoice/audit/notification snapshots, live grant and step-up denial, maximum-length normalization, address/full revision replay, immutable history, mandatory paid refunds, payment and activation. Other integration cases were intentionally unselected.
- Customer forms — seven helper, 19 new component and 13 existing page/geography cases pass. Staff forms — eight helper, 18 new component and one dictionary-parity case pass; all three original staff page cases also have passing evidence. Four affected cases and targeted web TypeScript/lint pass after the final preview/schema repair. Unrelated solar cases are excluded from the total.
- `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/electricity-correction-forms.spec.ts e2e/electricity-simple-journey.spec.ts e2e/electricity-journey.spec.ts --project=chromium --project=mobile-safari --workers=2 --reporter=line,json` initially passes all eight existing journey cases. After production focus and fixture repairs, the same runtime selecting only `e2e/electricity-correction-forms.spec.ts` passes all 12 affected cases, with zero skipped/flaky outcomes. English light/Persian dark staff/address/simple/advanced flows retain scoped Axe, mobile bounds, linked focus, draft preservation, duplicate-request, privacy and exact uncertain-retry assertions. The final stale-400 guard is covered by its focused unit regression; unchanged browser cases are not repeated.
- Successful captures are preserved and inspected externally. Staff/address feedback, drafts and Persian RTL are visible. Nested scrolling clips whole revision captures, so visual review covers their visible lower fields; unseen date/quantity controls are verified behaviorally rather than claimed visually inspected.
- Root build and final affected web build pass. Final TypeScript, root plus affected lint, contracts/suppressions and all 84 existing bundle budgets pass. Strict security passes five fixtures over 1,656 files with zero findings/errors. Ten production source hashes bind the final build. Formatting, canonical backlog and staged checks precede publication.

External initial/final logs, source bindings, independent reviews, captures and publication readback: `/Users/majid/.local/state/barghsa-manual-batches/electricity-correction-resubmission-forms/`.

## Deployment and remaining scope

No migration, endpoint, dependency or accepted contract-shape change is required. Deploy the API with or before the frontend for owned server field feedback. Domain services, financial command bodies and shared UI infrastructure remain unchanged.

The preceding solar commit passes all five jobs in [CI run 37230249962](https://github.com/barghsadev/barghsa-core/actions/runs/37230249962); new exact-commit CI is tracked separately. Canonical backlog remains valid at 1,355 tasks and 116 traceability entries. Queue/ledger, historical loop state, scheduler and supervisor state are unchanged. This batch does not claim complete electricity, dashboard or shared-form coverage.
