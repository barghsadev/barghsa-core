# Responsive Email/SMS provider tables — October 5, 2026

## Scope

This batch adopts the existing shared table foundation on Email and SMS.ir configuration lists. It contributes to `05-notifications-documents-ai.md#T-05.06.04`, `#T-05.07.05`, `#T-05.08.03` and `07-ui-ux-design.md#T-07.24.01.01` through `#T-07.24.01.04`. Existing provider, health, native-form and shared-component engines are reused, not counted again. Wider domain table adoption and the global all-list task remain partial.

Desktop tables retain server ordering, native record headers, sticky headers, named keyboard-scrollable viewports and localized row counts. Mobile cards retain configuration labels, transport/status, saved tests, activation/creation metadata, delivery health, circuit pauses, alert history, SMS credit warnings and authorized lifecycle actions. Shared text/date cells isolate content and preserve the account timezone. Health numbers/percentages and SMS credit follow the published numeral preference.

Email test recipients now have one page-owned draft per saved configuration basis. Both responsive presentations share it. Failed reads retain recipients and editors with mutation locks; accepted configuration changes retire the corresponding recipient. Current denial and actor cleanup remove private recipients together with the existing editor/confirmation state. Email/SMS editor drafts, secrets, mappings and protected actions remain outside the duplicated record presentations. Existing captured step-up, receipt validation, saved-state review and write-only credential behavior remain.

No API, database, dependency, financial engine, CI setting or historical supervisor-state change.

## Validation and review

- All **40 source cases** pass across `delivery-provider-recovery.test.tsx` and `provider-forms.test.tsx` on the final source.
- **102 distinct Chromium/mobile Safari scenarios** have passing evidence: eight new responsive cases and 94 retained provider settings/recovery/native-form/version scenarios. They cover both locales, retained light/dark flows, scoped Axe, RTL, mobile bounds, keyboard scrolling, account-zone dates, published numerals, raw draft ownership, secret masking, recovery, denial, lifecycle receipts and OTP step-up.
- The initial run passed 90/102. Eight old cases selected provider names as table cells; those names now use native row headers/cards, so the selectors target visible records. The new English cases exposed a locale-fixture hook scoped across both locale groups; it is now scoped to each group. The final English date assertion preserves the existing 12-hour locale display while verifying the account timezone. Selective reruns retain all original domain assertions, with no retries, disabled accessibility rules or skipped required scenarios.
- Production web build, root types, changed-file lint/format, contracts/suppression, canonical backlog and whitespace checks pass. All **85 unchanged gzip budgets** pass. Strict SAST scans **1,794 files with zero findings/errors** and passes all five fixtures. Unchanged API suites are not rerun or claimed as current evidence.
- Focused source review checks action/gate equivalence, one recipient/editor/confirmation owner, saved-basis invalidation, private cleanup, masked credentials, metadata equivalence, locale/numerals/timezone and native accessibility. Two complete original Persian fixture-data cards are visually reviewed for release attachments.

Evidence: `/Users/majid/.local/state/barghsa-manual-batches/delivery-provider-tables/`. Exact commands, logs, JSON results, distinct-case aggregation, review hashes and release receipts remain outside the checkout. Repeated runs are excluded from distinct counts. Production source/assets remain unchanged during the selective browser selector/fixture repairs.

## Release and continuation

Release **v0.1.11** updates the shared login version and `releases/0.1.11.md`. Validate notes/channel/screenshots on the clean committed HEAD, push normally to `main`, read the remote SHA back and immediately enqueue that exact commit with both reviewed screenshots. CI and deployment remain independent of the next build; publication and completed deployment/Telegram receipts are recorded externally. No PR is created.

The preceding v0.1.10 release completed at `2026-10-05T18:55:02Z`, with exact live commit `220bec684e14b4db68ad3fa4fb213a4cd688b757`. Persian Telegram notes (32) and both screenshots (33, 34) are confirmed.

Failed-job and failed-notification queue tables are a next candidate. Confirm actual remaining gaps against current source and canonical criteria before selecting; command recovery and saved-target review are already built and should be reused.
