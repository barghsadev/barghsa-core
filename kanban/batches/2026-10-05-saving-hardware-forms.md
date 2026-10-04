# Saving hardware and upgrade cancellation forms — October 5, 2026

Status: built and independently reviewed; direct-main publication and exact-commit CI are recorded separately.

## Kanban scope

This batch completes form, receipt and retry adoption for staff paid saving hardware amendments and pending-upgrade cancellations. It advances `07-ui-ux-design.md#T-07.10.01.02` through `07-ui-ux-design.md#T-07.10.01.06`; those global parents remain partial. Existing domain tasks `03-core-business.md#T-03.09.04.05`, `03-core-business.md#T-03.09.04.04`, `03-core-business.md#T-03.10.03.03` and financial review tasks `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` remain preserved, without recounting their engines.

- Staff get touched validation, linked English/Persian help and errors, first-invalid focus and separate cancellation reasons for each upgrade. Customer upgrade history stays read-only.
- Complete existing financial parsers and summary rows bind hardware options, price/VAT/delta/stock, contract/version, customer/agreement/address and invoice/refund context. The original invoice total remains distinct from the latest hardware price basis.
- Shared address/hardware/cancellation ownership captures immutable body, hash and idempotency key. Actual password step-up and uncertain responses preserve the exact command for retry. Only a matching actual 201 hardware or 200 cancellation receipt clears its owning draft; a GET cannot prove an uncertain POST.
- Actor/profile/resource/source generations fence stale callbacks. Current denial withdraws private work and sibling draft caches. Interrupted pagination can retry an unsettled cursor through the actual query hook, while accepted cursor cycle protection remains intact.
- API field metadata covers only all-owned hardware/reason or cancellation-reason issues after current live authority. Protected, mixed, extra and root issues remain generic. Equal-price hardware retains contracts-only authority; nonzero price changes and cancellations retain existing invoice authority. Valid transaction bodies, replay, locking, stock, payment and audit behavior remain unchanged.

## Review and corrections

Independent source reviews approve all 19 implementation/test paths at their recorded hashes. Review tightened complete source binding, withdrawn sibling draft caching and actual interrupted-page recovery. Service/controller preservation comparisons confirm that read-only error preflights do not rewrite the valid business transactions.

The first browser run passed four immediate-swap cases and failed four charge/cancellation cases because the sibling address button looked enabled during an unresolved hardware command. Its synchronous submission guard already worked. One parent blocked predicate now observes hardware/cancellation ownership; both affected source recovery cases and all eight rebuilt browser cases pass, with the original browser assertions retained. Initial failures and traces remain available.

## Validation

**86 distinct related source/API/dictionary cases and eight distinct production browser cases pass**, excluding reruns.

- Frontend: 25 focused page, seven helper/schema, one dictionary parity, four original staff-page and seven retained paid-address cases. Original staff-page expectations and the paid-address child implementation remain preserved.
- API: 28 controller and 12 authority cases, plus two real connected HTTP journeys. These retain original payment, gift, stock, credit, cancellation, invoice/version/history and exact replay assertions, and add owned/protected failures, current grant/session/step-up, missing/foreign resources and no-write snapshots. Five unrelated HTTP cases are intentionally unselected. Disposable probe-budget rows are restored without changing production quotas.
- Production browser: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/saving-hardware-forms.spec.ts --project=chromium --project=mobile-safari --workers=2 --retries=0 --reporter=line,json` passes eight cases, zero skips/flakes/unexpected outcomes. English light and Persian dark cover positive charges and cancellation, zero/credit swaps, captured retries, actual password step-up, stale/current privacy handling, independent drafts, shared command locks, linked focus, hover/focus Axe and mobile bounds.
- Sixteen compact captures are preserved and independently inspected at original resolution. Mobile hardware captures have sticky-header overlap at the top heading/help; controls, feedback and actions remain visible. Native long text clips or scrolls inside mobile inputs/selects. Full desktop captures and passing complete-dialog, Axe, focus and bounds assertions cover the remaining evidence; these are not full-page mobile captures.
- Root build passes seven tasks; the affected web app is rebuilt after the reviewed button correction. Final types pass eleven tasks. Root lint plus affected two-path lint, contracts, suppression and all 84 unchanged bundle limits pass. Strict SAST passes five fixtures over 1,686 files with zero findings/errors. Ten production/baseline hashes bind the final build. Formatting, canonical and staged checks precede publication.

External logs, initial failures, source/build bindings, independent reviews, capture inspection and publication readback: `/Users/majid/.local/state/barghsa-manual-batches/saving-hardware-forms/`.

The preceding change/address batch's exact-commit [CI run 37239392723](https://github.com/barghsadev/barghsa-core/actions/runs/37239392723) is fully successful, including combined source coverage. This batch's new remote CI result is tracked separately after publication.

## Deployment and remaining scope

No migration, dependency, endpoint or accepted command/receipt shape change is required. Deploy the API with or before the frontend for owned field feedback. Financial and authorization policy stays unchanged.

Canonical backlog validates at 1,355 tasks and 116 traceability entries. Generated queue/ledger, historical loop state, scheduler, supervisor state and CI settings remain unchanged. The next batch is staff saving approval/rejection and fulfillment stage forms, including equipment handover and optional skip, over the existing reviewed engines. Wider shared-form adoption and customer/staff journey work remains open.
