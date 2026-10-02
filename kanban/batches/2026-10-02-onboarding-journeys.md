# Combined profile onboarding, October 2, 2026

## Task coverage

- `07-ui-ux-design.md#T-07.28.01.01`: the full-page chooser accepts personal, company, or both with labeled native checkboxes.
- `07-ui-ux-design.md#T-07.28.01.04`: the final summary contains all profiles selected in this setup, their actual names/types/statuses, and an explicit dashboard profile choice. The first created profile is selected initially. Done saves the account context before entering the current `/app` dashboard.
- `07-ui-ux-design.md#T-07.28.01.05`: authenticated customer requests to `/app` or any `/app/*` path check profile availability before rendering and redirect to onboarding when none exist. Staff context remains independent. Unavailable reads show an error; an unavailable active context with existing profiles requires an explicit selection.

The existing personal/company stage requirements are retained from [Onboarding wizards](2026-10-02-onboarding-wizards.md). This batch closes that report's combined-selection and aggregate-summary gaps. Legacy drafts outside a setup still restore at their profile URL; a general draft directory remains separate.

## Build and review

One durable server record binds the accepted request key, owner, personal/company profile IDs and completion choice. Creation uses the existing profile service inside one transaction. An accepted request key replays its original selection without new profiles or audits, including after completion. A different selection or request key cannot create another setup while one remains open. The owned active-setup read recovers a lost response or reload, then resumes the first unfinished wizard or opens the aggregate summary. Profile order is personal then company, independent of checkbox click order. No personal fields are stored in browser storage.

Done locks the setup, its profiles and the actor account, then rechecks ownership, type, archive/status, customer eligibility and the live session/CSRF. Every selected profile must have been submitted. Account context, completion and audit commit together. The service reads persisted completion and accessible context back before acknowledging success and rechecks the session before commit. Replays cannot change the choice or undo a later profile-context change. Default/verification semantics remain those of the existing account/profile APIs: selecting the dashboard profile changes account context, and preserves physical profile defaults and staff verification decisions.

Client receipts validate setup identity, unique profile IDs/types, finalized names/statuses and the exact dashboard choice. Failed reads and malformed start/finish responses cannot advance the flow. The final choice remains available after a failed write. Profile URL changes remount completion state, obsolete responses cannot navigate another setup, and successful selection refreshes the existing account context and other tabs. The root route reuses its session result in the app layout and removes the old duplicate app profile check. Nested onboarding forms no longer run that unrelated profile-selection check.

Review corrects a nullable SQL CHECK that could otherwise accept a foreign completion choice, request-key replay across an existing setup, inaccessible context projection and strict TypeScript handling. Browser tests use the existing accessible Close controls for persistent success messages before advancing the next wizard. The OpenAPI contract documents request bodies, setup receipts and the optional setup in legacy profile completion.

## Validation

- Root build passes, followed by a final API build for the reviewed server changes. All eleven root TypeScript tasks, root lint, formatting, contract, suppressed-error, canonical backlog and diff checks pass before publication.
- `pnpm --filter @barghsa/web test`: 212 files and 2,476 cases pass.
- `pnpm --filter @barghsa/i18n test`: all 67 cases pass.
- 103 distinct related API cases have passing evidence across profile-service, profile-write HTTP and setup HTTP files. The final setup run passes all 32 cases, including concurrent retries, invalid selectors, unauthorized ownership, archive/type/status changes, row-lock waits, audit failure, session expiry, persisted acknowledgement and inaccessible context. Earlier failures and repeats are excluded.
- `pnpm --filter @barghsa/db test src/onboarding-journeys-upgrade.migrated.test.ts`: the populated production upgrade passes. Existing profiles and prior migration checksums remain unchanged; repeat migration is a no-op. The database rejects empty/duplicate/open setups and invalid completion choices, including the one-profile NULL case. Snapshot validation passes with no generated differences.
- 40 production browser scenarios pass on the reviewed frontend: 28 onboarding and 12 customer/staff navigation cases across Chromium/mobile Safari. Both languages cover complete personal/company forms, combined selection, saved-stage restoration, lost responses, aggregate status/default choice, failed/malformed finish receipts, zero-profile redirects, scoped Axe and mobile width bounds. Persian mobile summary rendering is inspected.
- All 69 unchanged route/interaction budgets pass. Strict Semgrep 1.176.1 scans 1,472 files with zero findings/errors; all five rule fixtures pass. Logs use `/tmp/barghsa-onboarding-journeys-*`.

Deploy migration `0240_onboarding_journeys`, then the API with or before the frontend. Existing individual-profile APIs remain compatible and return a nullable setup. Historical supervisor state, generated completion/event ledgers, scheduling and CI settings remain unchanged. The preceding wizard commit's CI run `37007987673` was cancelled during tests; its dependent coverage-exemption job failed because tests were cancelled. No CI success is claimed for that run. Exact-commit CI is read back after this direct main publication; fast-mode combined coverage remains an exemption rather than measured coverage.
