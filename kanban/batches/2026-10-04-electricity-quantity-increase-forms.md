# Electricity quantity increase forms — October 4, 2026

Status: built and independently reviewed; final local checks and direct-main publication are recorded separately.

## Kanban scope

This batch connects customer requested quantity, staff optional approval date and staff rejection reason. It applies shared-form tasks `07-ui-ux-design.md#T-07.10.01.02` through `07-ui-ux-design.md#T-07.10.01.06`; these parents remain partial outside this slice. Existing request, decision, amendment, signing, payment and history behavior supplies domain context `03-core-business.md#T-03.08.01.02` through `03-core-business.md#T-03.08.01.08`.

- Shared touched validation provides bilingual linked help/errors, invalid-control focus and preserved raw drafts. Quantity normalizes to the existing positive decimal string; date conversion retains browser-local timezone semantics. Approval validates its optional date independently of rejection's trimmed 1–1,000-character reason.
- The five existing API form boundaries expose only recognized editable `requestedKwh`, `effectiveFrom` or `reason` fields. Mixed, extra, protected and structural failures remain generic. Existing permissions, CSRF, step-up, schemas and service policy remain unchanged. Current policy caps use percentage units; older task prose and route names do not replace the actual contracts.
- Captured bodies, keys and financial review hashes survive unknown responses and explicit exact retry. Complete receipts bind the actual persisted request row and immutable amendment/signature/pricing evidence. An idempotent replay may legitimately return a progressed live row; an unsigned expired request may lack staff decision timestamps. Neither case is accepted without its applicable identity and evidence.
- Synchronous guards precede deferred validation. Actor/profile/contract/version and selection generations fence responses and obsolete callbacks. Editing a read-only preview invalidates both its success and error feedback. Denied or missing resources withdraw private work. Attempted or uncertain writes lock competing commands and navigation; authorized read-only previews can still be cancelled by refresh, lane or paging.
- Amendment consent, signing step-up, separate signing key, linked adjustment invoice and existing payment/activation history remain protected. A GET cannot prove an unknown write committed because it lacks the command key; recovery retains the captured POST.

## Review and corrections

Independent review repaired assumptions about progressed receipts, unsigned expiry, immutable signature documents, synchronous actor withdrawal, stale retry callbacks and queue recovery. Native outside-period dates receive the real generic 409 conflict; malformed local calendar values and owned server fields have separate unit proof. Complete nested error envelopes retain the existing distinct generic and owned validation codes.

Existing tests retain their financial, authority, cursor and recovery assertions. Fixtures now provide actual UUIDs, full request rows, review evidence and default 201 write responses. Three explicit lazy-import waits replace premature dialog observations. Type repairs annotate customer form inference and preserve API response assertions without accessing unknown values. An implicit standalone API-test rebuild temporarily removed shared declarations during a concurrent type check; the final sequential check passes after those test runs finish. Initial failures and affected reruns remain external.

Production accessibility testing found insufficient contrast on the hovered dark rejection button. A local background override retains its destructive text and focus ring; the unchanged scoped Axe assertion passes in both affected browsers. Shared themes and button infrastructure remain unchanged.

## Validation

**120 distinct related source/API/dictionary cases and 20 distinct production browser cases have passing evidence**, excluding reruns.

- API: 26 controller projections/authority cases, eight existing quantity math cases and seven live HTTP variants. HTTP proof covers no-write core financial/version/quantity/audit snapshots, live authority and step-up denial, actual rejected rows, exact replay and preserved signing/payment/history assertions. Other integration cases are intentionally unselected.
- Customer: 17 helper, 20 focused component and six original panel cases. Staff: six helper, 18 focused component, one dictionary-parity and two original page cases. Nine related combined navigation/recovery cases have passing evidence; unrelated price-adjustment cases are excluded.
- `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/electricity-quantity-increase-forms.spec.ts e2e/electricity-change-recovery.spec.ts e2e/electricity-change-query.spec.ts --grep 'increase|quantity' --project=chromium --project=mobile-safari --workers=2 --reporter=line,json` initially passes 19 cases. After the contrast correction, selecting only the two Persian dark staff cases passes both, with zero skipped/flaky outcomes. All eight new and 12 existing distinct cases therefore have passing evidence. Focus, privacy, exact bodies/retries, stale previews, scoped Axe and mobile bounds remain asserted.
- All 12 compact quantity/date/reason captures are preserved and visually inspected across English light/Persian dark and Chromium/mobile Safari. Labels, controls, wrapped feedback and RTL are complete without clipping. These field captures exclude the rejection button; its hovered contrast is measured by scoped Axe and the initial failure trace is preserved.
- Root build and final affected web build pass. Final TypeScript, root plus affected lint, contracts/suppressions and all 84 unchanged bundle budgets pass. Strict security passes five fixtures over 1,663 files with zero findings/errors. Formatting, canonical backlog and staged checks precede publication. Nine production source hashes bind the final build.

External initial/final logs, source bindings, independent reviews, captures and publication readback: `/Users/majid/.local/state/barghsa-manual-batches/electricity-quantity-increase-forms/`.

## Deployment and remaining scope

No migration, dependency, endpoint or accepted contract-shape change is required. Deploy the API with or before the frontend for owned field feedback. Domain services, pricing/cap policy and financial command bodies remain unchanged.

The preceding correction commit passes all five jobs in [CI run 37232117222](https://github.com/barghsadev/barghsa-core/actions/runs/37232117222); this batch's exact-commit CI is tracked separately. Canonical backlog remains valid at 1,355 tasks and 116 traceability entries. Generated queue/ledger, historical loop state, scheduler and supervisor state are unchanged. Separate price-adjustment forms and wider shared-form adoption remain open; this slice does not claim complete electricity or dashboard coverage.
