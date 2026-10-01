# Customer team and ownership recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: shared ListPage composition for customer legal-team members/invitations and account ownership requests. This batch also completes the explanatory owner-removal guard from `07-ui-ux-design.md#T-07.29.01.05`; existing backend owner protection remains unchanged. Owner badges include a crown, and pending invitation creation dates use account-local formatting.

Agent-list/detail parents remain partial: masked usernames, avatar/activity fields, optional invitation messages and broader history/detail criteria are not claimed complete. The all-list parent, remaining filter URL/search/sort criteria and unrelated settings remain partial. Existing invitation, role and ownership domain operations are not counted as newly built.

## Behavior and review

Profile, member and ownership reads recover independently. Accepted data, invitation text, local role choices and password review survive transient failure; commands wait for their required reads. Fresh roles require explicit draft reset, while changed membership or ownership metadata withdraws obsolete confirmation. A profile replacement or broadcast context change unmounts old member work and invalidates late invitation results. Team-management permission loss clears that team's private work while preserving account ownership requests. Session denial clears all private work.

Catalogue DTOs validate bounded safe identities, uniqueness, dates, role/status combinations and invitation privacy. Member responses must match the selected legal profile. Invitations require HTTP 201 with a valid returned ID; malformed success preserves the proposal. Role acknowledgements must match the confirmed role set and settle the local draft before authoritative refresh. Existing password step-up, incoming ownership acceptance, self-change sign-out and recipient confirmation remain supported. Shared recovery buttons remain available from open dialogs. Review addresses request ownership, stale-role acknowledgement and Safari focus restoration after refresh.

The shared resource hook has an optional HTTP 401 handler; the shared action dialog supplies the denial status to its existing callback. The customer team uses these to clear the entire account workspace on session expiry while keeping ownership requests accessible after team-specific HTTP 403. Existing callers retain their denial behavior. No backend, database, dependency, scheduler or CI configuration changes are included. Server authorization, locks, audit and mutation semantics remain authoritative. The API's existing row payload does not provide a full command receipt for every ownership operation; those broader domain contracts are unchanged.

## Validation

The full web suite passes all 1,671 cases, including 27 new customer-team cases. All 53 dictionary cases pass. All 48 distinct production browser scenarios have passing evidence across Chromium and mobile Safari: 32 unaffected passing scenarios from the initial run, eight corrected/affected legacy invitation and role cases, and the final eight recovery scenarios. Failed and repeated cases are excluded. The initial mobile failure was an ambiguous status assertion matching both success and loading; the assertion now names the intended notice. The final recovery fixture supplies an empty account invitation list, avoiding an unrelated global banner failure.

Both languages and themes, invitation/password content Axe, full-page Axe after account denial, keyboard focus, mobile bounds, table scrolling, session-denial recovery and Persian rendering are verified. Root build/types/lint/format, affected browser lint, contract/suppression and all 64 route budgets pass. Backlog and diff validation pass. The pinned strict security scan passes five rule fixtures and scans 1,325 files with zero findings or scanner errors.

## Publication

The preceding content publishing batch is `c8d0aee6265540bea8c764d4f9dc09d04c98de57`. GitHub CI run `36849225318` passes all five jobs under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This batch is published directly to main as `b6ce38235c37651db2e6a301a93a45922fa63acf`. Remote SHA and clean worktree were verified. GitHub CI run `36851257592` passes all five jobs under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage. No PR is created; historical supervisor state remains unchanged.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run`; `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs team-catalogue-recovery.spec.ts team.spec.ts --grep-invert 'dashboard invitations|invitation banner|invitation and terms' --project=chromium --project=mobile-safari --workers=1`
- Final affected browser rerun: same two files with `--grep 'customer team|invitation modal|invite and save'`
- Final recovery rerun: `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs team-catalogue-recovery.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Pinned external strict security scanner: `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-team-static-security-final.json`; local external PATH wrapper uses `--timeout 60 --jobs 2`, without changing rules, targets or exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
