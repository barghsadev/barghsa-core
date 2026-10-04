# Solar staff tracking and construction milestone forms — October 4, 2026

Status: built, independently reviewed and locally verified; direct-main publication and exact-commit CI are read back separately.

## Kanban scope

This batch applies `07-ui-ux-design.md#T-07.10.01.02` through `07-ui-ux-design.md#T-07.10.01.06` to staff shipment tracking and construction milestone forms. Domain context is `07-ui-ux-design.md#T-07.18.03.05`, `07-ui-ux-design.md#T-07.27.01.03`, `07-ui-ux-design.md#T-07.27.01.06` and `07-ui-ux-design.md#T-07.27.01.07`. Existing domain workflows remain; broader shared adoption and parent tasks remain open.

- Tracking uses shared touched validation, linked bilingual help/errors and invalid-control focus for arrival estimates, public HTTPS URLs and customer-visible notes. Notes normalize to 1–1,000 characters; optional URLs retain the existing public-URL policy and 2,000-character limit. The server still enforces shipment-date and revision constraints.
- Construction milestone notes use the same form behavior and existing 1–1,000-character limit. The ordered `in_progress`, `delivered` and `installed` commands preserve contract eligibility, revisions, live grants, review hashes and step-up requirements.
- Raw drafts remain independent from normalized commands. Full reviews and write receipts must match the captured actor/profile/request, revision and command. Uncertain writes preserve the original key, hash and body for explicit exact retry. A fresh settled read unlocks only after exact shipment proof or matching immutable milestone history; older or mismatching reads cannot authorize a new command.
- Selection and actor generations fence reads, lazy validation, reviews and dialog callbacks. Denied or missing resources withdraw private detail and drafts. Queue selection can invalidate a pending preview; actual dialog/write operations retain their lock. Field feedback projects only known editable identifiers, while protected/mixed structural failures remain generic and do not echo values.
- Tracking never confirms original documents, creates a contract or collects payment. Construction milestones never activate a contract or collect payment. Existing audit, notification and transactional services are unchanged.

## Review and corrections

Independent review repaired tracking visibility before passive actor cleanup, stale callbacks after reopening an exact retry, and missing-resource withdrawal in both editors. Unclassified write failures retain uncertainty; a failed or cancelled retry cannot erase a prior uncertain command. Helper validation now requires the complete review schema and validates read-side edit authority.

Initial source failures came from an unavailable spinner export and an incorrect hook import; both now use existing project APIs. Final TypeScript/lint checks caught an unnecessary summary property and a test-only link without an href; their affected cases pass. Browser fixtures now supply actual queue revision metadata and complete receipt/review shapes, and account for native URL-input whitespace handling. Existing assertions remain, including every original legacy journey assertion. Initial failures are retained externally.

## Validation

**179 distinct related unit/API/dictionary cases and 32 production browser cases have passing evidence**, excluding reruns.

- API source/controller projections and existing postal controller/validation suites — 82 pass. `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/solar/solar-postal-tracking.integration.test.ts src/solar/solar-progress.integration.test.ts` — 20 live HTTP cases pass, including owned field errors, exact no-write snapshots, live permission/step-up denial, maximum-length normalization and replay without duplicate effects.
- Web tracking cases — 14 component and seven helper cases pass. Construction cases — all 13 page and five helper cases have passing evidence, with affected missing-resource and link-stub reruns retained. Existing stage/progress, tracking validation, admin queue, list recovery and navigation cases — 37 pass. Dictionary parity — one pass.
- `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/solar-operation-forms.spec.ts e2e/solar-postal-tracking.spec.ts e2e/solar-construction-progress.spec.ts --project=chromium --project=mobile-safari --workers=2 --reporter=line,json` — 28/32 initially pass. After truthful fixture repair, the same runtime selecting `e2e/solar-operation-forms.spec.ts --grep 'solar tracking validates'` passes all four affected cases. Every distinct case has passing evidence, with zero skipped/flaky browser outcomes. Eight new combinations cover English light/Persian dark forms; 24 existing cases retain customer-visible evidence, queue recovery, selection races and exact lost-response retries. Scoped Axe, mobile bounds, duplicate-write, privacy and draft assertions remain enabled.
- English light/Persian dark construction and tracking captures are inspected and preserved externally. Nine production source hashes match the final build. Root build and final affected web build pass; TypeScript passes eleven tasks. Root lint plus affected final lint pass, as do contract/suppression checks and all 84 existing bundle budgets. Generated OpenAPI is identical to the baseline. Strict security passes all five fixtures over 1,650 files with zero findings/errors. Final formatting, canonical backlog and staged checks precede publication.

External initial/final logs, source hashes, reviews, captures and publication readback: `/Users/majid/.local/state/barghsa-manual-batches/solar-tracking-construction-forms/`.

## Deployment and remaining scope

No migration, endpoint, dependency or contract-shape change is required. Deploy the API with or before the frontend for owned server field feedback. Shared UI, financial flows and domain services are unchanged.

The preceding consultation commit has three successful gates with tests still running in [CI run 37228514643](https://github.com/barghsadev/barghsa-core/actions/runs/37228514643); new exact-commit CI is tracked separately. Canonical queue/ledger, historical loop state, scheduler and supervisor state are unchanged. This batch does not claim complete solar, dashboard or shared-form coverage.
