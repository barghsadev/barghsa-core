# Maintenance settings forms — v0.1.6

Canonical scope: `06-security-testing-observability.md#T-06.17.02.03`. Reuse the existing capability, permission, step-up, expected-version and audit engines. Shared-form parents `07-ui-ux-design.md#T-07.10.01.02`, `#T-07.10.01.04`, `#T-07.10.01.05` and `#T-07.10.01.06` remain partial across the application.

The previous form silently rejected invalid deadlines, interpreted dates in the device zone and reset after any successful response. The native shared form now provides bilingual linked feedback and first-invalid focus for the customer messages, owner and deadline. Calendar/clock selection uses the account zone, preserves untouched saved instants and rejects past times and DST gaps. Raw drafts survive field failures, read failures and stale versions.

Synchronous read/submission ownership prevents overlapping refresh and validation, competing edits and duplicate proposals. Confirmation shows the captured capability, status, messages, owner and return time. Reset requires a receipt matching the capability, contents and next version. An unknown save retains a locked draft, refreshes authorized saved status and requires deliberate review before another write. Denied reads/writes clear protected work. Account-zone changes require explicit saved-setting review.

API validation returns only editable public field names after authority/step-up checks. Mixed protected/unknown fields retain general errors; submitted values are never echoed. Backend mutation behavior, audit and capability gating remain unchanged. No migrations, dependencies, budgets, CI gates or historical supervisor state changed.

## Validation and review

- Web: `pnpm --filter @barghsa/web exec vitest run src/lib/maintenance-form.test.ts` — five cases pass, covering raw input, exact stored instants, account-zone conversion, DST/past limits and matching receipts/list shape.
- API: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/maintenance/maintenance-http.integration.test.ts src/common/input-field.exception.test.ts` — five cases pass, including real HTTP capability isolation, authority, step-up, field privacy, conflicts and audit.
- Browser: selected `maintenance-forms.spec.ts`, `maintenance.spec.ts` and `release-version.spec.ts` on Chromium/mobile Safari — all 20 distinct cases have passing evidence on final production assets. Final matrix: 19 pass, one Chromium English contrast scan ran during modal fade-in; waiting for actual opacity completion passes both affected confirmation cases. A further Persian capture uses complete section/dialog frames. No retries/skips or disabled accessibility checks.
- API/web builds, root `pnpm typecheck`, changed-file ESLint/Prettier, OpenAPI contract, suppression check and all 85 unchanged bundle budgets pass.
- Strict SAST: 1,790 files, zero findings/errors and five rule fixtures pass.
- Focused source/receipt review found and repaired a same-frame refresh/submission race, covered in both browser locales. Persian validation and confirmation captures are visually reviewed; screenshots use fixture data, not live customer records.

Evidence: `/Users/majid/.local/state/barghsa-manual-batches/maintenance-settings-forms/`. Publication and deployment receipts are external and separate from local validation. Push normally to `main`, then enqueue the exact pushed SHA with reviewed screenshots immediately; continue without waiting for CI/deployment. v0.1.5 is deployed with its Telegram notification confirmed.

The first release worker stopped at the notes-heading preflight before building, rollout or notification. The heading now follows the required `برقسا نسخه 0.1.6` format. Preserve the failed receipt externally, validate the corrected exact checkout and enqueue the same unshipped version at its corrected pushed SHA. Product source and passing tests remain unchanged.

The corrected release completed at `2026-10-05T17:38:39Z`: staging reports `0.1.6` and exact commit `cd60d0c0454b7de7be24f27123300453b6c6eaca`; Persian Telegram notes and both reviewed screenshots are confirmed. The failed preflight receipt remains archived externally and the corrected terminal worker receipt is authoritative.
