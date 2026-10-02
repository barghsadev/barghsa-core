# Onboarding wizard navigation, October 2, 2026

## Scope

Builds the personal and company onboarding portions of `07-ui-ux-design.md#T-07.22.01.04` and `07-ui-ux-design.md#T-07.22.01.05` together. Both forms now protect departure and restore their step from the URL. These framework tasks remain partially complete until the electricity, solar and saving wizards have equivalent coverage. Previously completed onboarding tasks remain complete.

## Behavior and review

An unsaved form offers Save and leave, Stay, or Leave without saving for application navigation. Failed saves and version conflicts retain the form and its edits. Save and leave uses the existing server draft, current CSRF cookie, serialized writes and exact next-version acknowledgement. It proceeds only when the latest values are saved. Escape and backdrop dismissal cannot interrupt that save. Uploads and final submission also block departure until their result is known. Browser reload and navigation out of the application use the browser's native warning, whose text and buttons the application cannot customize.

Personal steps are bounded to 1–3; company steps to 1–5. Invalid, fractional, negative, oversized, object and array values fall back to the first step. Step parsing loads with the onboarding component; the eager route declares the presentation input as unknown. No loader or mutation trusts that raw value. Only the bounded step controls rendering, and normal navigation writes the step number to the URL. Draft fields remain in the server draft. Reload restores that draft and the requested step. Browser Back/Forward between steps retain current edits, and final submission still validates every section.

Only a validated final profile receipt releases departure protection and stops subsequent draft saves. The confirmed form disables further editing and submission while its result opens. Old profile save results cannot authorize leaving a new profile. Existing draft, upload, finalization and combined-setup endpoints are reused without an API or migration change.

The dialog reuses existing Persian/English dictionary strings and theme tokens, supports RTL, traps focus through the existing dialog primitive, fits mobile width and loads only on attempted departure. Its new 15 KB budget adds to the 71 existing gates without increasing any prior limit. Review corrected invalid search fallback and kept step parsing out of the dashboard's eager bundle. Browser fixtures distinguish application history from navigation between separate documents.

## Validation

- `pnpm build`: all seven root build tasks pass. Subsequent `pnpm --filter @barghsa/web build` validates the final frontend changes.
- `pnpm --filter @barghsa/web test`: 216 files and 2,516 tests pass. `pnpm --filter @barghsa/web test src/lib/wizard-step.test.ts src/hooks/useOnboardingDraft.test.tsx` reruns all 21 directly related cases after final review.
- `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e onboarding-wizard.spec.ts --project=chromium --project=mobile-safari --workers=2`: all 44 final production cases pass. Coverage includes both languages, reload/deep links, dirty Back/Forward, explicit discard, failed save retry, live CSRF, in-flight departure protection, verified uploads, invalid final receipts and combined setup. Scoped Axe and mobile width checks pass.
- Root types, lint, format, OpenAPI, suppression, strict security, backlog validation and `git diff --check` pass. Strict security reports zero findings/errors and all five rule fixtures passing.
- `pnpm check:bundle`: all 72 measurements pass. Dashboard is 299.90 KB/300 KB, electricity ordering 254.79 KB/255 KB, and the deferred leave dialog 0.76 KB/15 KB. Previous limits are unchanged.
- Persian mobile dialog rendering inspected at `/tmp/barghsa-wizard-navigation-fa-dialog.png`.

## Publication and remaining work

The published onboarding commit `1fe1d60a16263ef6d8f3f5e746d96eae52fe3623` now passes all five exact-commit CI jobs in [run37020452010](https://github.com/barghsadev/barghsa-core/actions/runs/37020452010). The following [electricity batch](2026-10-02-electricity-wizard-navigation.md) completes the simple/advanced order portions and generalizes the shared leave dialog.

The preceding invitation commit `452799835f04f691d8f45b37b02bf830ee39a206` has all five exact-commit CI jobs passing in [run37016947392](https://github.com/barghsadev/barghsa-core/actions/runs/37016947392).

This is a manual batch committed and pushed directly to main, as requested. No PR, scheduler, historical supervisor snapshot, external state or generated completion/event ledger is changed. No migration is needed. Exact new CI is read back after publication; pending CI is reported as pending.

Next, apply the shared wizard requirements to the customer order forms, retaining their existing quote, review and submission safeguards. The general legacy draft directory remains separate.
