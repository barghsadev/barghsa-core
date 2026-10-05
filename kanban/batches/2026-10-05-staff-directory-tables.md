# Responsive staff directory and role catalogue — October 5, 2026

## Scope

This batch adopts the existing shared table foundation on two related staff surfaces: the user directory and role catalogue. It contributes to `02-auth-users-admin.md#T-05.03.01`, `#T-05.03.02`, `#T-09.05.01` and `07-ui-ux-design.md#T-07.24.01.01` through `#T-07.24.01.04`. Existing staff engines and shared components are reused, not counted again. Wider domain table adoption and the global all-list task remain partial.

Desktop tables retain native record headers, named keyboard-scrollable viewports and server ordering/pagination, with sticky column headers. Mobile cards show the same identity, roles, activation status/expiry, last login and authorized actions. Role cards retain grouped read-only permissions, including granted/ungranted module comparisons and wildcard roles. Shared text/date cells isolate identity and preserve the account timezone; row counts follow the published numeral preference.

Both presentations use the same page-owned drafts, permission checks, pending controls and captured actions. Changing screen size preserves role reasons and module selection. Failed reads retain accepted records with existing action locks; current denial removes private work from both presentations. Permission inspection, audit history, activation resend, role editing, self-disable protection and step-up behavior remain.

No API, database, dependency, financial engine, CI setting or historical supervisor-state change.

## Validation and review

- All **44 source cases** pass across `staff-access-native-forms.test.tsx`, `staff-directory-recovery.test.tsx` and `policy-catalogue-recovery.test.tsx` on the final source.
- **84 distinct Chromium/mobile Safari scenarios** have passing evidence: eight new responsive cases and 76 retained staff/version scenarios. The retained run passed 76/80; two new Farsi cases used a hard-coded Cancel label and two old Safari history cases selected a hidden table row. Dictionary-based cancellation and visible table/card selectors repair those tests while preserving their confirmation, history, privacy, focus, timezone and recovery assertions. All 12 affected cases pass in the final selective run on the same production assets, with no retries, skipped required cases or disabled accessibility rules.
- Production web build, root types, changed-file lint/format, contract/suppression checks, canonical backlog and whitespace checks pass. All **85 unchanged gzip budgets** pass. Strict SAST scans **1,792 files with zero findings/errors** and passes all five fixtures. Unchanged API suites are not rerun or claimed as current evidence.
- Focused source review checks action/capability equivalence, shared draft ownership, server ordering, read failure/denial behavior, localized metadata and native table/card accessibility. Browser verification includes scoped Axe, dark/light retained flows, RTL, mobile bounds and keyboard scrolling. Two complete original Persian fixture-data cards are visually reviewed for release attachments.

Evidence: `/Users/majid/.local/state/barghsa-manual-batches/staff-directory-tables/`. The exact commands, logs and browser result JSON remain there; repeated runs are excluded from distinct counts. The final browser command selects only the new responsive cases and affected permission-history cases. It uses four workers and completes in 16.36 seconds.

## Release and continuation

Release **v0.1.9** updates the shared login version and `releases/0.1.9.md`. Validate release preflight on the clean committed HEAD, push normally to `main`, read the remote SHA back and enqueue that exact commit with the reviewed screenshots. CI and deployment remain independent of the next build; publication and completed deployment/Telegram receipts are recorded externally. No PR is created.

The preceding v0.1.8 release completed at `2026-10-05T18:20:27Z`, with exact live commit `d66f6eb94ed4d54f7ad4fa5295c81b3b6f8bc6ba` and Persian Telegram notes/screenshots confirmed. Its first Docker Hub fetch failed before rollout; the explicit exact-commit retry completed.

Geography tables are a next candidate. Confirm the actual remaining gaps from current code and canonical criteria before choosing the next coherent batch; native settings forms already built should not be rebuilt.
