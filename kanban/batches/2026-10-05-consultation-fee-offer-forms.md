# Consultation fee-offer forms — October 5, 2026

Status: built and independently reviewed; direct-main publication and exact-commit CI are recorded separately.

## Kanban scope

This batch completes selected staff form, receipt and retry adoption for initial consultation offers, unpaid replacement and paid fee increases or credits. It advances `07-ui-ux-design.md#T-07.10.01.02` through `.06` and the fee-entry UI criterion of `03-core-business.md#T-03.03.03.02`. Global adoption/review parents and the wider consultation journey remain partial. Existing invoice, adjustment, refund, payment, policy, transaction and notification engines are retained.

- Shared native forms provide English/Persian touched feedback, linked errors and first-invalid focus. Positive whole-rial bounds, actual text limits and future deadlines are checked while raw drafts remain intact. Unchanged saved deadlines retain their exact seconds/offset; edited deadlines use the current account timezone.
- Complete financial previews bind the captured request/profile/invoice and normalized terms. Actual four/six-field 200 receipts must match the whole expected snapshot and invoice/refund identities, including unique refund IDs and the captured allocation count. Financial summary rows remain preserved; JSONB object-key order is ignored while array order remains significant.
- Captured body, hash and key survive password step-up, malformed receipts and uncertain responses. Exact retry retains the original command; a GET cannot release uncertainty. Synchronous ownership fences companion controls and obsolete callbacks. Current denial withdraws private work, while an old selection's denial cannot withdraw a new scope.
- Successful operations clear only consumed fields. Paid revision preserves hidden ordinary scope/deliverables and independent nonfinancial reason drafts. Unknown commands retain their original UTC deadline through timezone preference loading/change; only a bound receipt restores an editable current-timezone deadline.
- Four selected API parsers expose only complete owned field identifiers after current live authority. Protected, mixed, root, route and extra inputs stay generic without server text. Existing ordinary invoice permissions/step-up and paid financial authority remain enforced.
- Authorized identical stored commands return the original durable receipt after deadline expiry or legitimate customer payment/progress. Stored actor, resource, profile, normalized body and review must agree; ambiguous or incomplete proof is rejected. New writes retain existing eligibility, future deadline, locks and policy/refund checks. Domain financial effects remain once-only; the existing successful wrapper-audit behavior is preserved byte-for-byte.

## Review and corrections

Independent source reviews approve the API, frontend and browser implementations at recorded hashes. Review corrected hidden paid companion draft restoration and timezone ownership without relaxing actor/source fences. Initial HTTP proof failures were a test helper's TEXT/UUID parameter mix and a default five-second timeout shorter than its deliberate expiry wait; two explicit UUID casts and per-case 30-second timeouts preserve all original journey assertions. Both final connected HTTP proofs pass.

The initial browser run failed all eight cases. Three fixture repairs select the actual unique admin content, wait for the new credit preview before calculating its receipt and retain rotated CSRF across subsequent authentication reads. A separate Safari failure exposed a real native-blur race: a held touched-field schema loader compared the entire draft and returned inactive validation after companion edits, clearing a later submit error. The exact sequence failed locally before the narrow fix. Removing only that loader's whole-draft comparison retains its actor/source/timezone fences and both command freshness checks. The regression and final complete browser matrix pass; initial logs, traces, captures and assertions remain preserved.

The preceding saving batch's exact-commit CI failed one delayed-review navigation test because it asserted its held fetch resolver before lazy validation reached the request. This batch waits for the same original assertion before changing selection. Both saving/electricity cases pass; all stale-selection and business assertions and production remain unchanged. CI settings are unchanged.

## Validation

**104 distinct batch source/API/dictionary cases, two prior-CI regression cases and eight production browser cases pass**, excluding reruns.

- Frontend: 25 fee page, 15 helper/schema, one native-blur regression, six retained queue, eleven unchanged independent-reason and one dictionary parity cases. The final coherent web run covers all 58 source cases; unchanged parity supplies the remaining case.
- API: 25 controller and 18 authority/replay cases, plus two connected existing workflow/payment journeys. HTTP proofs retain original issuance, replacement, charge/credit, payment, invoice and refund assertions and add owned/generic/current-denial probes, durable original receipts after real expiry/payment and changed actor/body/hash rejection. Full database effect snapshots exclude only the preserved successful wrapper audit. Seven unrelated HTTP cases are intentionally unselected.
- Browser: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/consultation-fee-offer-forms.spec.ts --project=chromium --project=mobile-safari --workers=2 --retries=0 --reporter=line,json` passes eight cases with zero skips, flakes or retries. English light and Persian dark cover initial/replacement and paid charge/two-invoice credit, full financial summaries, first-invalid focus, duplicate guards, actual password/rotated CSRF, exact uncertain recovery, timezone changes, current/stale privacy, scoped Axe and mobile bounds.
- Sixteen compact field/complete-outcome captures are preserved and independently inspected at original resolution, with no actionable visual issue. Full financial rows have runtime text/accessibility assertions; captures do not include every complete dialog, native keyboard or popup.
- Initial integrated build passes; final affected web/dependency build passes four tasks with three cached. Final types pass eleven tasks. Root lint, contracts, suppression, formatting, all 84 unchanged bundle limits and canonical backlog checks pass. Strict SAST passes five rule fixtures over 1,698 files with zero findings/errors. Exact reviewed source and production asset hashes are recorded externally.

External evidence, including initial failures, source/build bindings, reviews, complete test-result preservation and publication/CI readback: `/Users/majid/.local/state/barghsa-manual-batches/consultation-fee-offer-forms/`.

## Deployment and remaining scope

Deploy the API with or before the frontend for typed feedback and durable saved-command recovery. No migration, dependency, endpoint or accepted command/receipt shape change is required. New-write financial policy is unchanged.

Canonical backlog validates at 1,355 tasks and 116 traceability entries. Generated queue/ledger, historical loop state, supervisor state, scheduler, global dictionary and CI settings remain unchanged. The next coherent batch is consultation paid cancellation/rejection and uncovered-credit refund recovery form/receipt/retry adoption, using the existing financial engines.
