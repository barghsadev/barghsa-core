# Customer wizard section reviews, October 2, 2026

## Scope and result

This batch implements `07-ui-ux-design.md#T-07.22.01.03` across personal/company onboarding, simple/advanced electricity, saving orders and solar requests together. Shared `StepReviewPage` groups collected values under named sections and offers a section-specific Edit action. Inputs are collected before the final review: electricity addresses are on stage four with gift codes, and saving gift codes are on the agreement stage before its final review.

Personal/company reviews group identity, representative, company, addresses and document names into their matching form stages. Electricity reviews include the period, product quantities, gift code, delivery address/postal code, active profile, financial quote and contract/cancellation terms. Saving includes the plan, hardware, bill, address/postal code, agreement, applied gift and financial quote. Solar groups the verified server submission into property, grid and terms sections.

Financial values remain exact formatted strings from existing server quotes, including their lines, discounts, VAT and authoritative total. No client-side total is introduced. Solar uses its existing verified server review and agreement version. Existing final consent/submission actions remain outside the read-only collected-data sections.

## Review and recovery

Edit actions use each form's existing verified draft-save transaction before changing stages. Failed or mismatched saves retain the current review and values. Editing quantities or gift codes refreshes the existing server quote; solar edits require another verified review. Existing quote, contract, agreement, hash/version and idempotency safeguards remain in force. Busy/completed forms disable Edit actions, and onboarding returns focus to the edited stage.

Review repaired an advanced-electricity departure check that captured an outdated dirty flag after a successful save. Navigation now checks the live and confirmed draft signatures synchronously; failed saves and pending commands retain protection. A unit regression checks the blocker during the immediate address-settings navigation, and the existing full order journey covers its saved return.

The application shell supplies the single main landmark; nested main elements in the three affected service pages are removed. Review headings, labeled Edit buttons, literal escaped values and bidirectional isolation support both locales. Saving agreement text flows within the main page so keyboard users can read all terms without a separate scroll trap. Existing tests now target the individual review sections and actual page direction rather than expecting one summary list or a nested main landmark. The preceding draft-list test's Link mock also renders its children explicitly to satisfy root accessibility lint.

## Validation

- Root `pnpm build`: seven tasks pass. Root `pnpm typecheck`: 11 tasks pass.
- Focused web component, form, draft-protection and navigation tests: **69 distinct cases pass** across nine files. The final saving render adjustment also passes its two existing form cases.
- Dictionary suite: **68 cases pass**.
- The six related production browser files contain **192 distinct Chromium/mobile-Safari scenarios with passing evidence**, across English and Persian. The second full run passes 172 and identifies 20 failures; all affected cases pass in the subsequent **36-case** repair run. A final **18-case** run verifies the saving review/fulfillment journey and company/combined onboarding against the final build. New tests cover all six forms' read-only sections, matching Edit targets, failed-save retention, refreshed financial/solar input, Axe and mobile width. The Persian dark mobile saving review is inspected.
- Root lint, formatting, OpenAPI, suppressed-error and diff checks pass. Backlog validation covers 1,355 tasks and 116 traceability entries. All **73 existing bundle budgets pass** without changing limits: dashboard 299.43 KB / 300 KB; electricity ordering 254.31 KB / 255 KB. Strict security scans **1,494 files** with zero findings/errors and all five rule fixtures passing.

The initial browser run passes 153 and fails 39; failures include review-layout selectors, stale departure state, nested landmarks, a keyboard-inaccessible scroll region and an autosave fixture race. They are not treated as baseline failures. Recovery scopes the completion assertions to the actual result list, waits for the fixture's scheduled failing autosave before gating a manual retry, and verifies route redirects at navigation commit. Failure and repair logs remain in `/tmp/barghsa-wizard-review-browser*.log`. No full unrelated repository test suite is claimed.

## Deployment and publication

No API, schema, dependency, migration or bundle-limit change is required. Deploy the frontend with the existing API. Earlier drafts can still resume their saved stages; a final review missing an address offers Edit to return to its address stage.

Publication uses direct main through Git/GitHub CLI, with local, remote and GitHub branch SHA agreement read back. Exact-commit CI is read back after pushing; pending checks are not counted as success. The preceding profile-directory run37033890400 has successful static security and secret checks, a failed integrity job and running tests at the last readback. This batch repairs the draft-list Link mock that fails local accessibility lint; the final root lint passes. No PR, scheduler, external supervisor state/handoff, historical `kanban/loop-state.json`, or generated completion/event history is changed. Other unfinished epic criteria remain open.
