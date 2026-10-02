# Shared customer wizard framework, October 2, 2026

## Scope and result

This related six-form batch finishes the shared framework criteria in `07-ui-ux-design.md#T-07.22.01.01` and `07-ui-ux-design.md#T-07.10.02.01`. Personal/company onboarding, simple/advanced electricity, solar and saving all use `FormWizard`. The existing stepper supplies numbered circles, connected completed/current/pending states, responsive horizontal/vertical layout and localized state text for assistive technology. Ordinals follow the published numeral preference. Other business-progress steppers retain their existing icons and details.

Saving previously duplicated its indicator and navigation controls. It now adopts the shared component while retaining its six established stages and handlers. Back is available on every non-first stage; Save, Continue and Submit retain their command locks, draft-save confirmation, current-stage validation, unfinished-address protection, equipment/agreement acceptance, reviewed quote and submission recovery. The existing forms still own validation, server drafts, URL/history and final submission. Step indicators are read-only and cannot skip validation. No backend or draft format changes are introduced.

The preceding review batch supplies the shared read-only final sections. Current framework work does not claim the separate react-hook-form `FormStep`, dynamic-field-array or dependent-select tasks complete.

## Review and validation

The source review identified saving's remaining standalone controls and migrated them before publication. Existing unit/browser assertions now identify the restored stage by its localized label rather than a literal digit and punctuation, preserving their saved-stage and navigation checks. Shared stepper defaults remain unchanged when no ordinal is supplied.

- Root build passes all seven tasks; root typecheck passes all 11 tasks.
- The existing shared workflow suite passes **33 cases**; seven focused form/draft/navigation files pass **57 web cases**. Saving's final component adoption also passes its two existing form cases. Dictionary suite passes **68 cases**.
- **104 distinct production Chromium/mobile-Safari scenarios have passing evidence** across the 68-case shared-wizard selection and the final 60-case complete saving/solar and saving-fulfillment run. Both locales, light/dark themes, saved-stage recovery, failed-save retention, pending command protection, invalid final receipts, original retry keys, review editing, Axe and mobile width are covered. The final Persian mobile saving indicator is inspected.
- Saving's first complete rerun passes 26 and fails four final-receipt cases because they still expect digit-plus-period text. Those assertions now identify the actual localized review stage for both saving and solar. The final 60-case run passes; failures are not counted as passes or assumed to be baseline failures.
- Root lint, format, OpenAPI, suppressed-error and diff checks pass. Backlog validation covers 1,355 tasks and 116 traceability entries. All 73 bundle limits remain unchanged and pass. Strict security scans 1,494 files with zero findings/errors and all five rule fixtures passing.

The numbered form indicators remain steady while the default business-workflow icons retain their existing current-stage animation. The final build passes, all 73 budgets pass (dashboard 299.49 KB / 300 KB; electricity ordering 254.37 KB / 255 KB), and four final saving review scenarios pass with Axe, mobile width and inspected Persian mobile rendering. No unrelated full repository test suite is claimed.

## Deployment and publication

No migration, API, dependency or bundle-limit change is required. Deploy the frontend with the existing API. Existing saved drafts and retained saving consent rules remain compatible.

Publication uses direct main through Git/GitHub CLI. Local, remote and GitHub branch SHA agreement and the clean checkout are verified after pushing; the exact-commit CI run is read back, with pending checks reported as pending. The preceding review commit `e9bcf2857fe3ee6a8ef460491572602a0530fb34` passes all five exact-commit CI jobs in [run37037452706](https://github.com/barghsadev/barghsa-core/actions/runs/37037452706). No PR, scheduler, external supervisor state/handoff, historical `kanban/loop-state.json`, or generated completion/event history is changed. Other epic criteria remain open.
