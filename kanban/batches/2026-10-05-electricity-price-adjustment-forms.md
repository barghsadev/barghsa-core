# Electricity price adjustment forms — October 5, 2026

Status: built and independently reviewed; direct-main publication and exact-commit CI are recorded separately.

## Kanban scope

This batch connects the staff contract picker and signed price proposal with customer adjustment history. It advances shared-form tasks `07-ui-ux-design.md#T-07.10.01.02` through `07-ui-ux-design.md#T-07.10.01.06`; those parents remain partial outside this slice. Existing price-adjustment tasks `03-core-business.md#T-03.08.02.01` through `03-core-business.md#T-03.08.02.04` provide domain context.

- Staff validation covers the contract UUID, signed percentage, effective date, reason and contractual basis. Bilingual linked feedback, first-error focus and touched validation retain raw drafts. Valid UUIDs normalize locally to lowercase. The existing percentage, timezone and financial rules remain authoritative.
- The API exposes only recognized editable proposal fields at preview and publish boundaries. Mixed, extra, protected and structural failures remain generic. Existing schemas, permissions, CSRF, step-up and service policy remain unchanged.
- Customer history validates complete persisted rows and financial calculations before disclosure. Reason and basis render as text. Historical versions remain valid; actor, profile, contract and current-version changes fence reads and obsolete callbacks. Denied or missing resources withdraw private history. Customers receive no new acceptance command.
- Preview freshness follows raw inputs and selection generations. Captured publish, finalize and cancel bodies, hashes and keys survive unknown responses and explicit exact retry. Receipt matching accepts legitimate progressed rows while checking immutable financial evidence. GET cannot prove an uncertain POST committed.
- Calculation digests retain the service's original constructor order. Semantic receipt comparison tolerates reordered JSONB keys without relaxing values or component order. Finalize and cancel keep their actual protected command shapes.

## Review and corrections

Independent review corrected selector normalization and a read/write race: starting a captured financial command now aborts and invalidates older refresh responses, preventing late reads from clearing exact retry state. Two focused cases cover late denial and changed authority/profile responses. Existing combined tests retain their financial, privacy, navigation and recovery assertions; fixtures now use actual complete rows, UUIDs, statuses, timestamps and raw calculation hashes. Financial fixtures calculate the effective-date proration rather than assuming a fixed half-year interval.

Final TypeScript found one optional argument annotation that did not admit an explicitly supplied `undefined`. An independently inspected, single type-union correction resolves it; expressions and runtime behavior are unchanged. Final root types pass. The production build and browser proof remain applicable to the unchanged runtime code, with original and final source bindings recorded externally.

## Validation

**95 distinct related source/API/dictionary cases and 16 distinct production browser cases have passing evidence**, excluding reruns.

- API: 23 controller boundary cases, five existing calculation cases and two live HTTP charge/credit variants. HTTP proof covers owned field feedback, mixed protected rejection, no-write financial/audit snapshots, live authority and step-up denial, complete receipts, exact replay after finalization and cancellation, linked invoices and immutable paid history. Other HTTP variants are intentionally unselected.
- Customer: eight decoder, 18 focused history and two original panel cases. Staff: seven helper, 18 focused page, one dictionary-parity and four original staff/conversion cases. Seven related combined navigation/recovery cases pass. Overlapping original customer cases are counted once.
- `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/electricity-price-adjustment-forms.spec.ts e2e/electricity-change-recovery.spec.ts e2e/electricity-change-query.spec.ts --grep 'price' --project=chromium --project=mobile-safari --workers=2 --reporter=line,json` passes all 16 cases, with zero skipped, flaky or failed outcomes. English light and Persian dark flows cover focus, stale previews, full disclosures, exact financial retries, denied recovery, scoped Axe and mobile bounds.
- All 12 compact picker, proposal and disclosure captures are preserved and visually inspected. Feedback and focus rings are legible, UUID direction and Persian RTL are correct, and mobile financial disclosure stacks without clipping.
- Root production build passes seven tasks; final types pass 11 tasks. Root and affected lint, contracts and final suppression scan pass. All 84 unchanged route/interaction budgets pass. Strict security passes five fixtures over 1,668 files with zero findings/errors; the later erased type union is independently reviewed. The initial suppression scan raced Playwright's deletion of its output directory; the final scan passes after the browser run. Formatting, canonical backlog and staged checks precede publication.

External logs, initial failures, final source bindings, independent reviews, captures and publication readback: `/Users/majid/.local/state/barghsa-manual-batches/electricity-price-adjustment-forms/`.

## Deployment and remaining scope

No migration, dependency, endpoint or accepted contract-shape change is required. Deploy the API with or before the frontend for owned field feedback. Domain services, financial policy, paid invoices and command bodies remain unchanged.

The preceding quantity-form commit has three successful CI gates while its test job remains pending in [run 37233944434](https://github.com/barghsadev/barghsa-core/actions/runs/37233944434); this batch's exact-commit CI is tracked separately. Canonical backlog validates at 1,355 tasks and 116 traceability entries. Generated queue/ledger, historical loop state, scheduler and supervisor state remain unchanged. Wider shared-form adoption and remaining customer/staff journeys are still open; this slice does not claim complete electricity or dashboard coverage.
