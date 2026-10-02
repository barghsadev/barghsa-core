# Customer invitation decisions, October 2, 2026

## Scope

Completes the customer invitation widget `07-ui-ux-design.md#T-07.19.02.04` and dashboard banner `07-ui-ux-design.md#T-07.29.01.04`. The same account-bound banner is available on the onboarding chooser, so an invited customer can join a company without first creating a personal or company profile.

Existing directory, invite-message, member details, activity and ownership work remains documented in the earlier team batches. This batch does not recreate those features.

## Behavior and review

Pending invitations remain visible until Accept or Decline. The banner identifies the company, role, inviter, invitation dates, optional message and company identifiers. A finalized personal profile supplies the inviter's name; unfinished draft identity is excluded, with the inviter username as fallback. Pending rows resolve the current recipient and legal company in one database statement.

Both decisions send the displayed company and role. The server rechecks them under existing profile/account/invitation locks before writing, reads back the persisted outcome and returns a structured receipt. Acceptance retains atomic membership, audit and session rotation; decline retains live session and expiry checks. Older empty proposals remain compatible. Invalid or incomplete proposals fail validation; changed targets fail before writes or cookie rotation. OpenAPI documents proposals and receipts.

The interface validates the full invitation list and exact decision receipt. Refresh failures retain accepted details and pause decisions. Account changes abort obsolete reads and commands; explicit permission denial clears private data. One account-level command can run at a time, including across multiple invitation rows, because acceptance rotates credentials. Each command reads the current CSRF cookie.

An accepted card retains its company and offers **Open profile**. Acceptance preserves an existing workspace selection. The existing server rule can initialize the first accessible company for a customer with no prior profile context. Only the explicit Open action switches the saved workspace through the existing profile API, validates its receipt, refreshes context and navigates to the dashboard. Joining and declining never manufacture a personal profile.

Persian/English strings, RTL, native detail disclosure, theme tokens, mobile wrapping and local retry are included. Details reuse the banner's timezone read. Card display loads only when validated invitations are present; decision transport loads on action. All 69 existing bundle limits remain unchanged, with two additional 15 KB gates for these separate entries.

Review addressed receipt binding, divergent persisted writes, stale account completions, privacy clearing, serialized cookie rotation, read recovery and unnecessary eager display code. Acceptance keeps its original session/invitation deadline recheck after the persisted receipt read and immediately before commit. The onboarding browser fixture now includes explicit empty invitations and a saved timezone, so its original setup-failure assertions test the intended failure.

## Validation

- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/profiles/invitation-acceptance-http.integration.test.ts src/profiles/invitation-mutation-http.integration.test.ts src/profiles/invitation-http.integration.test.ts src/profiles/agents.service.test.ts src/profiles/agents.controller.test.ts`: 95 cases pass on the final API build.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/profiles/onboarding-journeys-http.integration.test.ts`: 32 cases pass. Together, 127 distinct related API cases pass.
- `pnpm --filter @barghsa/web test`: 214 files and 2,495 cases pass. The 19 invitation cases also pass after the final lazy-loading test adjustment.
- `pnpm --filter @barghsa/i18n test`: 67 cases pass.
- Production Chromium/mobile-Safari invitation and chooser browser suite: 20 cases pass on the final build. It covers both languages, dark/light scoped Axe checks, viewport width, no dismiss action, retained recovery, rotated CSRF and explicit profile opening.
- Root build and types pass. All 71 budget measurements pass; existing limits are unchanged. Dashboard is 299.97 KB/300 KB; electricity ordering is 254.84 KB/255 KB. Invitation cards are 1.12 KB/15 KB and decisions 0.46 KB/15 KB.
- Lint, format, OpenAPI and suppression checks pass. Strict security scans 1,477 files with zero findings/errors and five passing fixtures. Backlog validation and `git diff --check` pass before commit.
- Persian mobile dark rendering: inspected at `/tmp/barghsa-invitation-widget-fa-dark.png`.

## Publication

No new migration is needed for invitation decisions. Deploy the expanded API with or before the frontend. The preceding onboarding repair requires migration0241 after0240 and has all five exact-commit CI gates passing in [run37014404086](https://github.com/barghsadev/barghsa-core/actions/runs/37014404086).

This is a direct-main manual batch, as requested. No PR, CI settings, scheduler, historical supervisor snapshot or generated completion/event ledger is changed. Exact invitation CI is read back after publication; pending CI is not claimed as passing.
