# Saving staff decision and fulfillment forms — October 5, 2026

Status: built and independently reviewed; direct-main publication and exact-commit CI are recorded separately.

## Kanban scope

This batch completes staff approval/rejection and fulfillment-stage form, receipt and retry adoption, including equipment handover completion and optional skip. It advances `07-ui-ux-design.md#T-07.10.01.02` through `.06` and selected UI criteria of `03-core-business.md#T-03.10.01.02`/`.04`. Global adoption and review parents remain partial. Existing decision, refund, stage, prerequisite, payment, stock, audit, notification and financial-review engines remain preserved and are not counted again.

- Linked English/Persian touched feedback and first-invalid focus replace silent invalid buttons. Approval preserves an unused rejection draft. Stage explanation is required; equipment completion requires handover details, while optional skip can omit them.
- Complete existing financial previews bind exposed customer, agreement, pricing, contract/version and original invoice/paid/refund context. Nested pricing arrays retain line order while ignoring JSONB object-key order. Stage identities/statuses match despite different public-detail and financial-review ordering; actual rejection outcomes, next stage and commercial transition are checked.
- Synchronous shared ownership fences address, hardware, cancellation and operation controls, reads and stale callbacks. Immutable captured body/hash/key survive actual password step-up and uncertain responses. Only matching actual 200 decision or stage receipts clear consumed fields. A GET or rejected uncertain retry cannot replace an unknown command.
- Current denied/missing resources withdraw private drafts and reviews; obsolete callbacks cannot withdraw a new scope. Independent address/hardware drafts survive successful operations. Original financial summary rows and the paid-address implementation remain preserved; the hardware helper changes only its compatible owner-kind type union.
- Four API input routes project only owned reason/explanation/handover identifiers after current live authority. Protected, mixed, extra, root and invalid route inputs stay generic. Decision mutation retains its default permission wrapper; stage mutation retains `financialReview: true`. No extra invoice grant, new business eligibility check or valid transaction change is added. Protected-only approval remains unchanged.

## Review and corrections

Independent reviews approve all 19 implementation/test paths at recorded hashes. Review tightened impossible preview outcomes, next-stage semantics, complete nested pricing binding and visible sibling command locks. Financial summaries match the published JSX after whitespace normalization; removing the added read-only API preflight restores the prior service exactly.

Initial frontend failures exposed a summary extraction error, nested-array comparison issue and obsolete fixture labels/step-up assumptions. Focused repaired cases pass; initial logs remain available. Final types found a test fixture union requiring a single stage-property guard. Both affected cases pass with all assertions retained.

The initial browser run passes four decision cases and fails four stage cases at an undefined fixture permission-code alias. Both aliases now use the actual shared catalog entry; all five used catalog keys resolve. Only the four affected stage cases rerun, all pass, and production inputs remain unchanged. Original assertions, failure traces and captures are preserved.

## Validation

**86 distinct related source/API/dictionary cases and eight distinct production browser cases pass**, excluding reruns.

- Frontend: 24 focused page, eight helper/schema, one dictionary parity, four original admin and nine retained hardware/address cases. Original admin expectations are retained, with two additional expectations.
- API: 27 controller and 12 authority cases, plus one real connected HTTP journey. The journey retains original approval, paid refund, invoice, stock, audit, history and prerequisites, and adds four-route safe/generic/no-effect/current-denial probes, contract-only feedback and exact stored approval/stage receipts after terminal progress. Six unrelated HTTP journeys are intentionally unselected. Disposable probe-budget rows are restored without changing production quotas.
- Browser: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/saving-staff-operation-forms.spec.ts --project=chromium --project=mobile-safari --workers=2 --retries=0 --reporter=line,json`, followed by only `--grep 'saving stage handover'` after the fixture repair. Four initial decision cases plus four final stage cases supply eight distinct passing proofs, with no skips, flakes or retries. English light and Persian dark cover both refund receipt outcomes, approval draft retention, conditional handover/skip, complete stage history, actual password/rotated CSRF, exact uncertain recovery, stale/current privacy, sibling locks, focus/hover Axe and mobile bounds.
- Sixteen compact field/history captures are preserved and independently inspected at original resolution, with no actionable visual issue or sticky-header overlap. Long single-line input text clips inside its control; full values are asserted. Captures omit entire financial dialogs, device keyboards and native popups; complete source/HTTP financial proof and scoped dialog accessibility supply separate evidence.
- API build passes four tasks; combined build passes seven, with four cached. Final types pass eleven tasks. Root lint and affected test/fixture lint, contracts and all 84 unchanged bundle limits pass. Strict SAST passes five fixtures over 1,691 files with zero findings/errors. The three subsequent test-only repairs are outside the scanner's file set; all ten production/baseline build inputs remain unchanged. Suppression, formatting, canonical and staged checks precede publication.

External logs, initial failures, exact source/build bindings, independent reviews, captures and publication readback: `/Users/majid/.local/state/barghsa-manual-batches/saving-staff-decision-fulfillment-forms/`.

## Deployment and remaining scope

No migration, dependency, endpoint or accepted command/receipt shape change is required. Deploy the API with or before the frontend for owned field feedback. Financial, authorization, stage and replay policies remain unchanged.

Canonical backlog validates at 1,355 tasks and 116 traceability entries. Generated queue/ledger, historical loop state, scheduler, supervisor state, global dictionary and CI settings remain unchanged. The next selected batch is consultation fee-offer forms: initial issue, unpaid replacement and paid fee revision, including the narrowly required authorized exact replay after expiry or customer payment. Existing financial engines remain its foundation; wider adoption and customer/staff journey work remains open.
