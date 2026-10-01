# Notification inbox URLs, October 1, 2026

## Scope and behavior

This related batch extends `07-ui-ux-design.md#T-07.18.02.04` across customer `/notifications` and staff `/admin/inbox`. All/Unread and the current cursor survive reload and Back/Forward; filter changes reset the cursor. Strict route parsing retains only these public selections. The API's base64url timestamp/UUID boundary is preserved byte for byte, including PostgreSQL microseconds. Malformed cursors, unknown filters and private query fields do not reach the API.

Next-page reads append and deduplicate; restored/history pages replace the current window. Failed reads retain accepted rows and retry the exact query. Explicit refresh returns to the first page while retaining the prior rows until recovery. The pending More control remains visible and disabled. Read marking retains existing optimistic rollback, authoritative zero-count handling and permission denial. Current URL scope and request generation prevent old pages or write receipts from replacing new results or navigating to an obsolete target. Actions require rows accepted for the current scope. Bell reads and operating contexts remain independent. Standalone consumers retain their local controls.

## Review

Both route adapters, cursor encoding/decoding, append/replacement behavior, refresh/retry and write callbacks were reviewed against the API. Existing browser fixtures now use real encoded cursors instead of `older-page`. Strict types caught an optional-prop mismatch in the staff wrapper; it is fixed without relaxing types. Initial Chromium recovery runs exposed a fixture race: retained rows were mistaken for a completed refresh, so the mock changed back to success before the request. The fixture now waits for the failure alert before retrying. Remaining repeated executions were stopped after diagnosing the same race, and the entire affected recovery file is rerun. Review added the accepted-scope guard before final release validation. No API, schema, dependency or dictionary change is needed.

## Validation

- `pnpm --filter @barghsa/web exec vitest run src/lib/notification-inbox-query.test.ts src/pages/notification-inbox-navigation.test.tsx src/pages/notification-inbox-recovery.test.tsx src/lib/notification-inbox-api.test.ts src/lib/notifications.test.ts` passes all 104 cases across five files. This includes 22 parsing cases, six bound navigation cases and existing recovery/client behavior. The full web and unchanged dictionary suites are not rerun.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/notification-inbox-query.spec.ts e2e/notification-inbox-list-recovery.spec.ts e2e/notification-center-recovery.spec.ts --project=chromium --project=mobile-safari --workers=2` supplies passing evidence for eight new URL flows and 12 unchanged delayed-read/optimistic-write/bell flows. After repairing the fixture race, the same production command targeting only `e2e/notification-inbox-list-recovery.spec.ts` passes all 16 final recovery scenarios. All 36 distinct scenarios therefore have passing evidence; repeated executions are not counted as extra coverage. Both languages, actual light/dark themes, full-page/scoped Axe, mobile bounds, denial, exact retry and obsolete receipts are verified. Both Persian dark mobile inboxes are visually inspected.
- Root build passes seven tasks; root types pass 11. Root lint and final page lint, contract/suppression and all 64 release budgets pass. Strict security passes five fixtures and scans 1,379 files with zero findings/errors. Formatting, backlog and diff checks are completed before publication.

## Publication

The preceding electricity adjustment commit `5926b2f058c0c9c9bb0b0aca0caaa901096776f4` passes all five gates in [CI run 36896399859](https://github.com/barghsadev/barghsa-core/actions/runs/36896399859).

This batch is published directly to main after validation, with local/remote SHA, clean tree and exact-commit CI registration read back. New CI is pending at publication. Other legacy filters and unfinished domain criteria remain open; global URL serialization stays partial. No PR, supervisor state, handoff, historical completion or scheduler change is included. Existing temporary CI fast mode and its combined-coverage exemption remain; no measured coverage is claimed.
