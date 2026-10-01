# Team directory and personal invitations, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.29.01.01` and `07-ui-ux-design.md#T-07.29.01.02` form this batch. The active legal-profile directory gains initials avatars, individual-profile names, masked email/mobile display, role badges, active/pending status, separate invitation and membership dates, a last-active date, an owner crown and transfer action on the owner row. Existing invitation, role, removal and ownership operations remain available.

Last active means the recorded account sign-in, explained on the page. It is not online presence or activity in this legal profile. Initials avatars do not require an avatar-upload feature. Original invitation dates are captured for new acceptances; direct and historical memberships retain an unknown date rather than a fabricated backfill. The agent-detail/activity-history dialog in `07-ui-ux-design.md#T-07.29.01.03` remains open. Broader ListPage/filter criteria are not claimed complete.

## Behavior and review

The invitation form accepts an optional plain-text message of up to 1,000 characters. The API stores it in the same audited transaction as the invitation, and the intended recipient sees it in private invitation details. Blank notes become null; failed commands retain the draft. React renders the note as text, including HTML-looking content. A PostgreSQL constraint bounds stored messages. The invitation list still avoids joining registered accounts, so pending rows never reveal recipient registration, names, identities or sign-in dates.

Active member names come from one unarchived individual profile, chosen deterministically without duplicating multi-role membership rows. Full contacts are masked in the directory, ownership picker and confirmation summary. Existing permission gates, password verification, account/profile recovery and owner-removal protection remain supported.

The API rejects self-invitations after current authorization and normalized identity are rechecked under the account locks, before any invitation, notice or audit event is created. Acceptance testing found and repaired the previously missing owner self-invitation guard.

Review also found that replacing all member roles could reset original membership dates. The transaction now carries the earliest original invitation, joined and creation dates into new roles. Migration `0230_team_directory_metadata` adds nullable columns for the note and original invitation date. Existing rows and dates remain intact. Apply the additive migration before running the new API; old application code can tolerate the added nullable columns.

## Validation

The full web suite passes 1,678 cases, including seven new directory/message cases. After the final column-width adjustment, the 35 affected team and shared-action cases pass again. All 102 related API/service/controller and real HTTP/PostgreSQL cases pass. The database upgrade and production-baseline tests pass three cases, and all 53 dictionary cases pass.

All 68 distinct production browser scenarios have passing evidence across Chromium and mobile Safari. The first run passes 64 scenarios; four invitation-modal scenarios stop at an obsolete five-column assertion. After updating that assertion and fixing the mobile column widths, all 24 affected directory, recovery, invitation-modal and role scenarios pass. Counting 44 unaffected first-run passes and 24 final passes excludes failures and repeated runs. Both languages/themes, scoped Axe checks, private-note rendering, keyboard focus, horizontal scrolling, mobile row height/page bounds and Persian rendering are verified. Existing dashboard, invitation acceptance/withdrawal, role changes and ownership confirmation flows remain supported.

Final root build/types, root plus affected lint, formatting, contract/suppression and all 64 route budgets pass. Generated database snapshot checks pass. Backlog validation passes 1,355 tasks and 116 traceability entries. The pinned strict security scan passes all five rule fixtures and scans 1,325 files with zero findings or scanner errors. Diff checks pass.

## Publication

The previous team-recovery batch is `b6ce38235c37651db2e6a301a93a45922fa63acf`. GitHub CI run `36851257592` passes all five jobs under the existing temporary fast mode. Combined-coverage success is an exemption, not measured coverage.

This batch is committed and pushed directly to main as `5aec92e78fbb9aaafa234559bb2a7ed1aa72e6bf` after validation. Remote SHA, clean worktree and exact-commit GitHub CI registration are read back after publication; the next batch records the immutable SHA and completed CI result. No PR is created. Historical supervisor state, scheduler and CI gates remain unchanged.

## Commands

- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`; `pnpm check:db-snapshot`
- `pnpm --filter @barghsa/web exec vitest run`; final affected rerun with `src/pages/team-catalogue-recovery.test.tsx src/components/TeamActionDialog.multipart.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/profiles/agents.service.test.ts src/profiles/agents.controller.test.ts src/profiles/agent-feature-http.integration.test.ts src/profiles/agent-mutation-http.integration.test.ts src/profiles/invitation-mutation-http.integration.test.ts`
- `pnpm --filter @barghsa/db exec vitest run src/team-directory-migration.test.ts src/migrate.baseline.test.ts`; `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs team-directory.spec.ts team-catalogue-recovery.spec.ts team.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Final affected browser rerun adds `--grep 'team directory|customer team|invitation modal|invite and save'`
- Pinned strict security scanner with the existing external wrapper using `--timeout 60 --jobs 2`, preserving all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
