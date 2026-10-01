# Team member details and activity, October 1, 2026

## Kanban scope

This batch completes `07-ui-ux-design.md#T-07.29.01.03`. Active members and pending invitations open a localized detail dialog from the legal-profile directory. It shows masked identity, roles, status, invitation/joined/sign-in dates, a pending invitation's plain-text note and activity history. Existing owner protection, role changes, password confirmation, removal and invitation withdrawal remain available.

The history is a list of recorded public profile activity and changes to the selected member's access. It is not a complete account audit log or online-presence feature. Pending invitation details do not look up a recipient account or reveal registration status. Broader shared list/filter and admin-settings criteria remain open.

## Behavior and review

The new read checks current owner/manager access and current membership under the same profile/membership locks as existing mutations. History is scoped to both profile and member. A finite allowlist maps existing audit events to public summaries; raw metadata, source IP, correlation IDs, passwords and internal comments are never returned. Legacy business events resolve through their own resource when profileId is absent, with domain-specific joins and guarded UUID conversion. Explicit profileId takes precedence. Invalid legacy JSON is excluded safely.

Pages contain up to 50 rows, ordered by exact database timestamp and audit ID. Opaque cursors retain microsecond precision, bind to profile/member and must name an existing scoped anchor. Equal and sub-millisecond dates do not skip or repeat rows. The UI retains accepted pages during failure, retries the exact failed cursor, deduplicates overlaps and stops repeated cursors. Permission denial clears private details; session denial also clears the account's ownership requests. Profile replacement and unmount invalidate late responses.

Table and detail forms share role draft controls. Failed team reads retain the draft while disabling commands. Fresh saved roles require explicit reset, and confirmation cancellation keeps the draft. Role/removal/withdrawal confirmations identify the target and consequences. Withdrawal now returns a backward-compatible target/status receipt, and delete success must be verified before showing a saved notice. Owner-plus-Manager membership is excluded from the new-owner picker.

Review corrected a wrong archive-column reference and a popup lifecycle bug. The role draft stays above the popup lifecycle, while the details popup unmounts during confirmation so it cannot remain behind another modal. Browser accessibility checks wait for the active popup's animations without disabling rules. Test repairs supply the required product fixture and use the actual localized failure wording. A final directory regression found a tall owner row after adding the details button. The action column is widened inside the existing keyboard-scrollable table; the original mobile height and page-bound assertions remain enforced.

Migration `0231_team_activity_history` adds member/profile lookup indexes to audit history. Its JSON expression tolerates existing malformed metadata. Migration tests preserve all populated rows and allow later invalid legacy JSON. The generated snapshot changes only audit_log, and journal order remains monotonic. The ordinary index migration can briefly block audit writes while creating indexes; use the existing migration deployment procedure.

## Validation

Passing evidence covers all 1,694 distinct web cases. The full run passes 1,692; two new invalid-receipt cases stop at obsolete error wording. After correcting those assertions, all 51 affected team/action cases pass, including the final popup-lifecycle rerun. All 110 related API/service/controller and real HTTP/PostgreSQL cases have passing evidence across the initial 102 existing cases and final eight activity cases. Migration and production-baseline tests pass three cases, and all 53 dictionary cases pass.

All 76 distinct production browser scenarios have passing evidence across Chromium and mobile Safari. The related regression passes 60 and exposes eight owner-row height regressions. After fixing the column width, all 16 affected directory/detail scenarios pass. This count excludes failed and repeated runs. Both languages/themes, active-popup Axe checks, keyboard roles, draft preservation, confirmation cancellation, scoped activity retry, public note rendering, focus return, mobile row height/page bounds and Persian screenshots are verified.

Final root build/types, root plus affected lint, formatting, contract/suppression, generated database snapshot and all 64 route budgets pass. Backlog validation passes 1,355 tasks and 116 traceability entries. Diff checks pass. The pinned strict security scan passes all five rule fixtures and scans 1,329 files with zero findings or scanner errors.

## Publication

The preceding directory/invitation batch is `5aec92e78fbb9aaafa234559bb2a7ed1aa72e6bf`. GitHub CI run `36853179568` has passed security, secret scanning and monorepo integrity; tests are still running at this batch's latest read. A completed result will be recorded when available. Existing temporary CI fast mode and the combined-coverage exemption are unchanged.

This batch is committed and pushed directly to main after local validation. The remote SHA, clean worktree and exact-commit CI registration are read back after publication. The next batch records the immutable SHA and completed CI result. No PR is created. Historical supervisor state, scheduler and CI gates remain unchanged.

## Commands

- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`; `pnpm check:db-snapshot`
- `pnpm --filter @barghsa/web exec vitest run`; final affected rerun with `src/pages/team-catalogue-recovery.test.tsx src/components/TeamActionDialog.multipart.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/profiles/agent-activity-http.integration.test.ts src/profiles/agents.service.test.ts src/profiles/agents.controller.test.ts src/profiles/agent-feature-http.integration.test.ts src/profiles/agent-mutation-http.integration.test.ts src/profiles/invitation-mutation-http.integration.test.ts`; final new activity HTTP rerun
- `pnpm --filter @barghsa/db exec vitest run src/team-activity-migration.test.ts src/migrate.baseline.test.ts`; `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs team-details.spec.ts --project=chromium --project=mobile-safari --workers=1`; final related regression with `team-directory.spec.ts team-catalogue-recovery.spec.ts team.spec.ts`
- Pinned strict security scanner with the existing external wrapper using `--timeout 60 --jobs 2`, preserving all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
