# Consultation intake, information and staff decision forms — October 4, 2026

Status: built, independently reviewed and locally verified; direct-main publication and exact-commit CI are read back separately.

## Kanban scope

This batch applies `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` to consultation intake, customer information replies and staff request-info/complete/unpaid reject/cancel decisions. Domain context is `03-core-business.md#T-03.03.02.02`, `03-core-business.md#T-03.03.02.03`, `03-core-business.md#T-03.03.03.02`, `03-core-business.md#T-03.03.03.05` and `03-core-business.md#T-03.03.03.06`. Wider shared form adoption and parent tasks remain open.

- Customer product selection and confirmation use shared touched validation, bilingual help, linked errors and invalid-control focus. Lazy validation rechecks the current catalogue before a first submission. An uncertain creation retains the same captured actor-bound submission key and body; a replacement or denied catalogue cannot turn it into a new command.
- Customer requested-information replies retain raw drafts and require a normalized reason of 1–2,000 characters. Exact receipts clear only the matching draft. Lost or malformed writes lock replay until a fresh authorized read proves a new matching customer history event after the captured immutable prefix. Reads started before the write settled cannot provide that proof.
- Staff decision reasons use independent form state, with 1–2,000 characters for nonfinancial actions and the existing 1–1,000 limit for paid decisions. Saving or recovering a reason preserves independent fee, scope, deliverables, deadline and offer-reason drafts. Live grants, invoice authority, funding prerequisites, step-up and existing financial preview/hash commands remain authoritative.
- API errors project only known editable `productId` or `reason` identifiers. Protected identities, submission keys, unknown keys and mixed structural failures remain generic. Staff capability checks precede owned field feedback; transactional authority, audits and notifications remain unchanged.
- Synchronous preparation and confirmation guards prevent duplicate writes. Actor/profile/request and selection generations fence late reads, lazy validation and previews. Customer denial withdraws private detail/form content while retaining its draft privately; staff denial clears selected detail and drafts. Malformed history cannot unlock an uncertain staff write. Reserved feedback space protects mobile submission positions. Product-group invalid state belongs to the radiogroup, while its radio retains focus and description linkage.

## Review and corrections

Independent review repaired two customer races: catalogue changes during deferred validation and recovery reads begun before a write settled. Regression cases retain captured-key replay and exact-history proof. Staff recovery rejects malformed history before rendering it; a missing indexed event cannot match the captured prefix.

Existing tests now await lazy validation and financial dialog transitions and use current creation/reply receipts. The paid-fee-to-paid-cancel regression retains every original charge, refund, hash and write assertion. New live HTTP fixtures distinguish the existing generic intake error code from owned-field errors, cast UUID/text snapshot predicates to their actual column types, and assert the current staff-context denial on a customer route. No service or authorization behavior changed to satisfy fixtures.

Initial browser failures are retained externally. Privacy assertions now target the customer/staff dashboard content uniquely. Scope/deliverables draft assertions use accessible textbox names after textarea values change. Synthetic duplicate submission resolves the background form while modal accessibility hides it; normal controls and accessibility checks still use the visible form. Exact-value, no-extra-write and fresh-read recovery assertions remain. The scanner's unsupported nested import type expression is replaced by an equivalent type-only namespace import, preserving mock runtime behavior and all 15 customer cases; security rules are unchanged.

## Validation

**75 distinct related unit/API/dictionary cases and 22 production browser cases have passing evidence**, excluding reruns.

- API controller source: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/consultation/consultation-forms.controller.test.ts` — 17 pass. Live HTTP selects `src/consultation/consultation-request.integration.test.ts` and `src/consultation/consultation-workflow.integration.test.ts` — all six distinct cases have passing evidence. The initial run passes four/six; affected reruns finish both new cases, preserving no-write snapshots, live grants, invoice authority and step-up checks.
- Web source: `pnpm --filter @barghsa/web exec vitest run` selecting new customer/staff form cases and related customer recovery, consultation queue, staff list recovery and support-query regressions — all 44 distinct relevant cases have passing evidence. Final affected customer/staff suites pass 26/26 after the semantic/type corrections. Unrelated cases are intentionally not selected. Helper cases — seven pass; bilingual dictionary parity — one pass.
- Production browsers: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/consultation-forms.spec.ts e2e/consultation-journey.spec.ts e2e/consultation-assignment-context.spec.ts --project=chromium --project=mobile-safari --workers=2 --reporter=line,json` — 14/22 initially pass. The same runtime selects `e2e/consultation-forms.spec.ts --grep 'consultation information|consultation staff reasons'` — four information cases pass, with four staff cases failing at a modal-hidden locator. After that repair, `--grep 'consultation staff reasons'` passes all four affected cases. Every distinct case has passing evidence without skipped/flaky browser outcomes. Twelve new cases cover English light/Persian dark intake, replies and staff reasons; ten existing cases retain assignment/history and the customer offer/payment/completion journey. Scoped Axe, mobile bounds, exact bodies and privacy/draft assertions remain enabled.
- English light Chromium customer and Persian dark mobile Safari staff captures are inspected and preserved externally. Eight final production hashes match the reviewed build. The final test-only parser repair passes 15/15 customer cases and TypeScript; final fixture lint passes.
- Root build and final affected build pass; TypeScript passes eleven tasks. Lint, contract/suppression checks and all 84 existing bundle budgets pass. Generated OpenAPI is identical to the baseline. Strict security passes all five fixtures over 1,644 files with zero findings/errors; initial parser failures are retained. Final formatting, backlog and staged checks precede publication.

External initial/final logs, source hashes, reviews, captures and publication readback: `/Users/majid/.local/state/barghsa-manual-batches/consultation-nonfinancial-forms/`.

## Deployment and remaining scope

No migration, endpoint, dependency or contract-shape change is required. Deploy the API with or before the frontend for owned server feedback. Existing assignment, offers, payment, paid adjustments/refunds, queues, targets and history remain.

Canonical queue/ledger, historical loop state, scheduler and supervisor state are unchanged. Other forms and broader shared adoption remain open; this batch does not claim complete consultation or dashboard coverage.
