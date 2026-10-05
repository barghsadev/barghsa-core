# Responsive province and city tables — October 5, 2026

## Scope

This batch adopts the existing shared table foundation on province and city management. It contributes to `02-auth-users-admin.md#T-09.02.01`, `#T-09.02.02` and `07-ui-ux-design.md#T-07.24.01.01` through `#T-07.24.01.04`. Existing geography CRUD, imports, recovery and shared components are reused, not counted again. Wider domain table adoption and the global all-list task remain partial.

Desktop tables retain server ordering and pagination, with native record headers, sticky column headers, bilingual named keyboard-scrollable viewports and localized row counts. Mobile cards show both names, status and the existing authorized actions. Shared text cells isolate each language and preserve escaped content.

One selected-province city workspace sits outside the two responsive presentations. Opening focuses its heading so it is discoverable below a full province list; closing returns focus to the visible province disclosure. Changing screen size preserves city edit/import drafts without creating another editor or list request. Failed reads retain accepted records and lock mutations; current denial clears both presentations and the city workspace. Import rejection remains linked to the unchanged raw rows independently of late local validation, until editing or deliberate resubmission.

No API, database, dependency, financial engine, CI setting or historical supervisor-state change.

## Validation and review

- All **32 source cases** pass across `geography-recovery.test.tsx`, `geography-pagination.test.tsx` and `geography-native-forms.test.tsx`. Import cases additionally verify owned rejection remains associated with the invalid field.
- **60 distinct Chromium/mobile Safari scenarios** have passing evidence: eight new responsive cases and 52 retained geography CRUD/recovery/native-form/version scenarios. They cover both locales, retained light/dark recovery, scoped Axe, RTL, mobile bounds, keyboard overflow, draft ownership, focus restoration and current denial. Repeated runs are excluded from distinct counts; no required case or accessibility rule is disabled.
- The first browser run exposed selectors aimed at hidden desktop records/navigation dialogs after responsive adoption. Those selectors now target visible records and accessible dialogs. Keyboard overflow is exercised in a deliberately constrained desktop host because these short tables otherwise fit. Desktop Axe found the page and table sharing a region name; separate bilingual table labels repair the product issue. Repeated concurrent import-feedback failures prompted a deterministic regression: blurring unchanged rejected rows cleared the server feedback in both languages. The final local ownership fix passes that regression, including feedback retirement after actual editing. Responsive workspace cases now use a full 20-province list and verify opening focus/visibility as well as closing focus.
- Production web build, root types, changed-file lint/format, contract/suppression checks, canonical backlog and whitespace checks pass. All **85 unchanged gzip budgets** pass. Strict SAST scans **1,793 files with zero findings/errors** and passes all five fixtures. Unchanged API suites are not rerun or claimed as current evidence.
- Focused source review checks capability/action equivalence, one city-workspace owner, retained drafts and saved records, failure/denial fencing, locale/numerals and native accessibility. Two complete original Persian fixture-data cards are visually reviewed for release attachments.

Evidence: `/Users/majid/.local/state/barghsa-manual-batches/geography-tables/`. Exact commands, logs, result JSON and distinct-case aggregation remain outside the checkout. The ordered 60-case run passed 59 cases; final selective reruns cover city-workspace/import paths after the ownership/focus repair, retaining prior passes for unchanged province-only/version paths. Translation compilation completes before web builds; an earlier concurrent translation/web build used the previous dictionary and is retained as failed evidence.

## Release and continuation

Release **v0.1.10** updates the shared login version and `releases/0.1.10.md`. Validate notes/channel/screenshots on the clean committed HEAD, push normally to `main`, read the remote SHA back and enqueue that exact commit with both reviewed screenshots. CI and deployment remain independent of the next build; publication and completed deployment/Telegram receipts are recorded externally. No PR is created.

The preceding v0.1.9 release completed at `2026-10-05T18:31:34Z`, with exact live commit `51d01ebe9d1b8d8a2a8236b0b4a8d561b98ad8a4`. Persian Telegram notes (29) and both screenshots (30, 31) are confirmed.

Delivery-provider metadata tables are a next candidate. Confirm remaining gaps against current source and canonical criteria before selecting; the existing Email/SMS native forms and provider engines should not be rebuilt.

Release v0.1.10 completed at `2026-10-05T18:55:02Z`; staging reports exact commit `220bec684e14b4db68ad3fa4fb213a4cd688b757`. Persian Telegram notes (32) and both screenshots (33, 34) are confirmed. The external `release-completed.json` retains the receipt.
