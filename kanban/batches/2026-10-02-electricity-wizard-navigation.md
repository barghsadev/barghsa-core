# Electricity wizard navigation, October 2, 2026

## Scope

Builds the simple and advanced electricity portions of `07-ui-ux-design.md#T-07.22.01.04` and `07-ui-ux-design.md#T-07.22.01.05` together. Both forms protect drafts during departure, preserve values through step navigation, and restore a safe URL step from the existing server draft. Combined with the preceding onboarding batch, these requirements now cover personal/company onboarding and both electricity order forms. The framework tasks remain partial for saving and solar forms; this batch does not mark the whole framework complete.

## Behavior and review

Application departure offers Save and leave, Stay, or Leave without saving. A failed or mismatched save retains the dialog and fields. Acknowledgement must match the submitted step and entire normalized draft, including nested quantities and the selected address; PostgreSQL JSONB key ordering is irrelevant. The existing API returns the saved contents, so no new API or migration is needed. Each write reads current CSRF, and synchronous command guards prevent duplicate saves or overlapping draft/order commands. Inputs freeze while commands run. Late acknowledgements from an unmounted or replaced form cannot advance it or navigate to an obsolete order.

Normal step changes create browser history. Back and review Edit actions save before changing stage; browser Back/Forward retains current in-memory values. Reload restores the existing server draft. URL steps are bounded to 1–5, and cannot skip beyond the latest confirmed stage. Invalid values select the first stage. The URL contains presentation state; private fields stay in the server draft. Failed draft reads retain recovery and keep mutation controls closed.

Pending draft, order and inline-address saves also protect departure when the draft was previously clean. Only a complete, valid order/contract/invoice UUID receipt marks a successful submission. Invalid success replies remain on the form and retry using the same idempotency key. Existing server quote digests, mandatory-green rules, contract terms, selected-address checks and submission review remain authoritative.

Simple ordering warns about an unfinished new address and disables Save and leave until that address is saved or cancelled. Explicit discard remains available when no command is pending. It cannot claim to have saved address fields that the order-draft API does not store. Native browser warnings cover reload or departure outside the application; their wording is browser-controlled.

The shared leave dialog replaces the onboarding-specific implementation and keeps its verified-save behavior, focus trap, keyboard protection, bilingual copy and RTL support. The simple price/review panel loads when stage three or five opens. The wizard controls wait with the review while its code loads, so a submission cannot precede visible financial review. Moving the whole simple form into a route chunk increased the measured ordering bundle, so the existing route arrangement is retained. All previous bundle limits remain unchanged; the deferred review has a separate 20 KB gate.

## Validation

- `pnpm build`: all seven root build tasks pass. Final `pnpm --filter @barghsa/web build` passes after review and bundle changes.
- `pnpm --filter @barghsa/web test`: all 217 files and 2,541 cases pass on the final source. Final directly related receipt/simple/advanced selection also passes all 42 cases, including duplicate commands, mismatched receipts, retained retries and obsolete completions.
- `pnpm --filter @barghsa/i18n test`: all 67 cases pass.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/electricity/electricity-order.integration.test.ts -t draft`: both matching API draft cases pass; 38 unrelated integration cases are intentionally unselected.
- Production Chromium/mobile-Safari browser checks have passing evidence for all 82 distinct scenarios: 30 new electricity navigation/recovery cases, eight existing electricity tracking/payment/contract cases and 44 onboarding regression cases. The final production build reruns all 38 electricity cases. Both languages, actual light/dark themes, mobile width and scoped Axe pass; repeats are not added to the scenario count.
- Root types, lint, format, OpenAPI, suppressed-error checks, backlog validation and `git diff --check` pass. Strict security scans 1,483 files with zero findings/errors and all five rule fixtures passing.
- `pnpm check:bundle`: all 73 gates pass. Dashboard is 299.33 KB/300 KB; electricity ordering 254.22 KB/255 KB; shared leave dialog 0.74 KB/15 KB; deferred simple review 2.69 KB/20 KB. Every prior limit is unchanged.
- Persian mobile dark-mode dialogs inspected at `/tmp/barghsa-electricity-simple-fa-dialog.png` and `/tmp/barghsa-electricity-advanced-fa-dialog.png`.

## Publication and remaining work

The preceding onboarding commit `1fe1d60a16263ef6d8f3f5e746d96eae52fe3623` passes all five exact-commit CI jobs in [run37020452010](https://github.com/barghsadev/barghsa-core/actions/runs/37020452010).

This manual batch uses direct-main publication as requested. Its pushed SHA and exact new CI are read back after the push; pending CI is reported as pending. No PR, scheduler, historical supervisor snapshot, external loop state or generated completion/event ledger is changed. No migration is required. Existing CI settings remain unchanged.

Next, extend the same requirements to the remaining saving and solar customer forms as a related batch. The general legacy draft directory remains separate.
