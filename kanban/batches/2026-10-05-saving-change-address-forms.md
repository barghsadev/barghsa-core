# Saving change and paid-address forms — October 5, 2026

Status: built and independently reviewed; direct-main publication and exact-commit CI are recorded separately.

## Kanban scope

This batch completes shared form adoption for customer unpaid saving hardware/address revisions and staff paid-address amendments. It advances `07-ui-ux-design.md#T-07.10.01.02` through `07-ui-ux-design.md#T-07.10.01.06`; these global parents remain partial. Existing domain behavior supplies context `03-core-business.md#T-03.09.04.05` and `03-core-business.md#T-03.09.04.04`. Financial review tasks `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` remain preserved, without recounting previously built transactions.

- Customer hardware/address and staff address/reason controls use deferred touched validation, bilingual linked help/errors and first-invalid focus. Raw drafts survive ordinary failures; staff address success preserves independent hardware and decision drafts.
- Customer reviews validate the complete quote, offered options, current profile/address, agreement, contract source and whole-IRR totals before confirmation. Staff reviews bind the actual paid invoice, contract, prior and replacement addresses and unchanged financial outcome. Original digest order and semantic JSONB receipt comparison remain correct.
- Synchronous preparation and write ownership capture immutable selections, exact serialized body, review digest/hash and idempotency key. Unknown or foreign receipts retain the captured command for explicit exact retry, including after a rejected uncertain retry. A GET cannot prove an uncertain POST. Actual matching 201 receipts release only the owning draft.
- Actor, confirmed profile context, order, source identity, lane and read generations fence stale callbacks. Current denied/missing resources withdraw private work, while a late obsolete denial cannot clear a new authorized selection. Accepted staff queue state remains available through read-only refresh.
- Only all-owned input issues receive safe field metadata after existing live resource/session/permission authority. Customer hardware/address and staff address/reason are owned; protected hashes, keys, expected version/address, mixed, extra and root errors remain generic. Valid service transactions, replay order, financial eligibility, step-up and locking remain unchanged.

## Review and corrections

Independent review tightened profile-address binding, complete financial source matching, whole-parent customer withdrawal and staff current-missing-detail withdrawal. A held lane-denial case verifies the final synchronous lane fence. API service comparison confirms that only read-only authority preflights were added; valid transaction bodies remain identical to their published base.

Final types exposed two test fixture issues: a tuple-spread metadata table and an explicitly typed fake request. The table now passes actual field arrays, and the denied request uses the existing fake-request typing pattern. Original expectations remain.

The previous comment commit's [CI run 37237596833](https://github.com/barghsadev/barghsa-core/actions/runs/37237596833) failed one English staff reason linkage test; the other 295 web test files and 3,651 cases passed. Its test waited for the invalid attribute before the effect registered the message ID. The repaired test waits for both original invalid and linked-copy assertions, without a fixed delay or weaker expectation. All four affected reason/deferred/owned-feedback cases pass. CI settings remain unchanged; the new commit's remote result is tracked separately.

## Validation

**103 distinct related source/API/dictionary cases and eight distinct production browser cases have passing evidence**, excluding reruns.

- API: 21 controller and seven same-authority preflight cases, plus two existing connected HTTP journeys. HTTP proof covers owned/protected failures, current grants/session/step-up, missing/foreign resources, complete receipts, exact stored replay and unchanged financial/inventory/audit state. Existing gift, discount, stock, payment, invoice/version/history and changed-address assertions remain. The two selected journeys run together because the first creates the saving gift used by the second; five unrelated cases are intentionally unselected. A narrow disposable probe-budget reset preserves the original rate-limit journey.
- Customer: 23 component, six helper and three parent-context cases. Staff: 29 focused component, three helper, one bilingual dictionary parity and four original staff-page cases. The four isolated prior-CI regression cases are counted separately. Initial fixture failures and affected rerun logs remain available; no removed assertions are counted as passing.
- Production command: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/saving-change-address-forms.spec.ts --project=chromium --project=mobile-safari --workers=2 --retries=0 --reporter=line,json`. Eight cases pass with zero skipped, flaky or unexpected outcomes. English light and Persian dark cover captured retries, malformed/foreign reviews and receipts, raw companions, deferred duplicates, actual password step-up, stale selection, current privacy withdrawal, explicit hover/focus Axe and mobile bounds.
- All eight initial browser failures have two fixture causes: a global alert locator also found an unrelated application alert, and the staff fixture expected OTP where the actual action uses password confirmation. The corrected main-scoped locator and actual password response/cookie fixture preserve all assertions. Initial traces and captures are preserved; production code and the tested bundle do not change for those repairs.
- Sixteen compact customer/staff fields, quote and cleared-state captures are preserved and independently inspected. Final visual approval binds the successful machine results, browser sources and production inputs. Mobile captures have documented framing limits: the sticky header occludes top rows, native selects truncate long addresses and the cleared staff frame shows only the reason. Full desktop views and passing full-review, focus, Axe and bounds assertions supply the remaining evidence.
- Root build passes seven tasks, followed only by affected web rebuilds for the two reviewed production corrections. Final types pass eleven tasks. Root lint and affected test-only lint, contracts, suppression scan and all 84 unchanged bundle limits pass. Strict security passes five fixtures over 1,681 files with zero findings/errors. Fifteen production/baseline input hashes bind the final build. Formatting, canonical backlog and staged checks precede publication.

External logs, initial failures, exact source bindings, independent reviews, captures and publication readback: `/Users/majid/.local/state/barghsa-manual-batches/saving-change-address-forms/`.

## Deployment and remaining scope

No migration, dependency, endpoint or accepted command/receipt shape change is required. Deploy the API with or before the frontend for owned field feedback. Domain transaction, invoice, payment, inventory, audit and step-up policy remain unchanged.

Canonical backlog validates at 1,355 tasks and 116 traceability entries. Generated queue/ledger, historical loop state, scheduler and supervisor state remain unchanged. Paid saving hardware amendment and pending-upgrade cancellation forms are the next selected batch: form, receipt and exact-retry adoption over existing reviewed engines, with dedicated domain copy and unchanged global dictionary/budgets; wider shared-form and customer/staff journey work remains open.
