# Staff access inspection, October 1, 2026

## Kanban scope

This batch completes `07-ui-ux-design.md#T-07.30.02.02`: a read-only role permission table grouped by module and effective permissions available directly from each staff account. It reuses the existing role catalogue, staff directory and permission endpoint. Remaining admin page criteria and domain journeys remain open.

## Behavior and review

The roles page can compare one module across all roles, including unchecked permissions and wildcard grants. Predefined permissions remain read-only. Each authorized staff row opens a named account dialog with assigned roles and grouped effective grants, without copying an account ID. The existing manual lookup uses the same validated renderer.

The server resolves the current account and role union in a transaction under the existing ordered account and role locks. It checks the reader's current permission and session before resolving the target and again checks the session before commit. Disabled accounts and accounts awaiting activation have no effective grants, while assigned roles remain visible. Responses are private and not cacheable.

The dialog rejects responses for another account and late cancelled work. Failed refreshes retain the accepted result with an explicit warning; a missing account clears it. Denial clears inspected permissions and refreshes directory authorization. Loss of role-edit permission closes inspection without hiding a still-authorized staff directory. Closing restores focus to the selected row. Both dictionaries, RTL, themes and mobile bounds are covered.

Review fixed duplicate accessible region names on the roles page, activation-state nullness and stale fixture authority data. The existing role-change browser journey now exercises OTP send, wrong-code recovery, exact-body retry and permission denial rather than obsolete password proof.

The preceding OTP CI also exposed a formatting issue in its browser fixture and a migration regression's expected row missing the nullable `step_up_session_id`. This batch repairs both while retaining the migration's full-row preservation assertion. No CI gate is weakened.

## Validation

The final web run passes 421 related cases across four files. All 53 dictionary cases pass. The final API recheck passes 43 cases: 38 service cases and five migrated PostgreSQL HTTP cases. Another 156 permission-boundary and staff HTTP cases passed in the earlier related run, giving evidence for 199 distinct related API cases. Failed and repeated runs are excluded; this is not a full API or web suite claim.

The HTTP cases exercise the current union, inactive accounts, wildcard recovery, missing targets and actual lock waits with permission revocation, session revocation, absolute expiry and target disablement. The corrected migration upgrade regression passes its one preservation case.

All 28 final production browser scenarios pass in Chromium and mobile Safari. They cover both languages and themes, scoped Axe, mobile bounds, focus restoration, role comparison, inspection recovery, directory recovery and the existing OTP role-change journey. Persian mobile dialogs in both themes were inspected.

Root build, types, lint and formatting pass, alongside unchanged OpenAPI consistency, suppression checks, all 64 route budgets, backlog validation and diff checks. The pinned strict security scanner passes five rule fixtures and scans 1,351 files with zero findings or scanner errors. No new schema or dependencies are added.

## Publication and CI

The preceding OTP commit is `7926b0ae61c16cd0d1b56d4f2f57d7b20a0de1c0`. Its [CI run 36864784045](https://github.com/barghsadev/barghsa-core/actions/runs/36864784045) failed formatting and the migration expectation above; security and secret scanning passed. Combined coverage failed downstream. The older audit [run 36862045325](https://github.com/barghsadev/barghsa-core/actions/runs/36862045325) is cancelled, with tests cancelled and downstream coverage failed; its integrity, security and secret jobs passed. Neither run is green.

This batch is committed and pushed directly to main after local validation, with remote SHA, clean worktree and exact-commit CI registration read back. Its remote CI outcome remains pending at publication. Existing temporary fast mode and the combined-coverage exemption remain unchanged; the exemption provides no coverage measurement. No PR, supervisor state, handoff or scheduler change is included.

## Commands

- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `pnpm --filter @barghsa/web exec vitest run src/components/staff-access-inspection.test.tsx src/pages/policy-catalogue-recovery.test.tsx src/pages/staff-directory-recovery.test.tsx src/pages/admin-boundaries.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/admin/admin.service.test.ts src/admin/staff-effective-permissions-http.integration.test.ts`
- Earlier related API run: `src/admin/admin.service.test.ts`, `src/admin/admin-permission-boundaries.test.ts`, `src/admin/staff-http.integration.test.ts`
- `pnpm --filter @barghsa/db exec vitest run src/migrate.password-reset-authorization.test.ts`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs staff-access-inspection.spec.ts policy-catalogue-recovery.spec.ts staff-users.spec.ts staff-directory-recovery.spec.ts --grep 'staff access inspection|role module comparison|role list recovery|staff permissions, confirmation|staff access and role choices' --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper, retaining all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
