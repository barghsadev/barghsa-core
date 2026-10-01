# Admin settings navigation and form sections, October 1, 2026

## Kanban scope

This batch completes `07-ui-ux-design.md#T-07.30.01.01` and `07-ui-ux-design.md#T-07.30.01.02`: shared admin settings navigation and the reusable per-section form pattern. It integrates the form pattern into contract electricity limits and OTP expiry settings. Other existing settings forms retain their current save workflow; broad page adoption remains separate work.

The next batch should assess `T-07.30.01.03` and `T-07.30.01.04` together against the existing versioned settings APIs: active/draft/history controls and current-versus-draft preview. Config audit history and OTP-based sensitive-action step-up remain open. Existing password confirmation is not counted as the specified OTP gate.

## Behavior and review

AdminSettingsLayout nests inside the existing authenticated admin shell. Twelve localized categories contain 25 implemented configuration routes. The desktop sidebar is bounded and scrolls the selected entry into view; narrow screens use a grouped native dropdown. Destination labels come from existing offered shell links. Unoffered routes are omitted, unknown destinations are rejected, and operational pages retain the normal workspace. Section navigation focuses the new content region. The staff operating-context route guard remains authoritative.

SettingsFormSection composes the shared card primitives around one named form, heading, description, fields and section actions. Each section submits independently. Callers retain ownership of mutation validation and report success only after a verified receipt. The existing lazy toast dispatcher announces one success per confirmed save, including under StrictMode and language rerenders.

Contract limit and OTP forms preserve existing immutable confirmation proposals, version/basis checks, password confirmation, fresh CSRF and uncertain-success handling. Save buttons explicitly remain disabled while confirmation owns the form. Reload does not replay a success toast. The OTP browser fixture now uses the current authenticated staff DTO and persisted locale. Review fixes an inaccessible mock-anchor lint pattern without altering production behavior.

## Validation

All 1,706 web cases and 53 dictionary cases pass. After the test-helper lint correction, the final 12 shared-layout/form cases and root types/lint pass. Root build, formatting, contract/suppression checks and all 64 route budgets pass. Backlog validation passes 1,355 tasks and 116 traceability entries.

All 56 distinct production browser scenarios pass across Chromium and mobile Safari: 16 new desktop/mobile settings journeys and 40 existing OTP/contract-settings recovery scenarios. The checks cover both languages/themes, keyboard focus, native dropdown and desktop navigation, field locking, invalid save receipts, exact retry payloads, verified success notifications, persisted values, password/fresh-CSRF handling, version conflicts, draft preservation and operational-layout fallback. Axe and page bounds pass. Persian mobile light and desktop dark screenshots were inspected. Failed or repeated runs are not included in these counts.

The final pinned strict security scan passes all five rule fixtures and scans 1,334 files with zero findings or scanner errors. Diff checks pass.

## Publication

The preceding member-detail batch is `ed5bca977c2bc436d55b6e6a46f222bd132fa433`. Its CI run `36855980923` passes security, secret scanning and integrity; tests remain running at the latest read. The older directory run `36853179568` is cancelled, so its former pending result must not be reported as passing. Existing temporary CI fast mode and the combined-coverage exemption are unchanged.

This batch is committed and pushed directly to main after local validation. Remote SHA, clean worktree and exact-commit CI registration are read back after publication. No PR is created. Historical supervisor state, external handoffs, scheduler and CI gates remain unchanged.

## Commands

- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `pnpm --filter @barghsa/web exec vitest run`; final affected rerun with `src/components/admin-settings-layout.test.tsx src/components/SettingsFormSection.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs admin-settings.spec.ts --project=chromium --project=mobile-safari --workers=1`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs otp-config.spec.ts contract-settings-recovery.spec.ts --project=chromium --project=mobile-safari --workers=1`
- `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper using `--timeout 60 --jobs 2`, preserving all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
