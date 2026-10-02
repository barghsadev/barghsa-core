# Unfinished profile recovery, October 2, 2026

## Scope and result

This related personal/company batch closes the older-profile resume gap behind `07-ui-ux-design.md#T-07.22.01.02` and the existing onboarding chooser in `07-ui-ux-design.md#T-07.28.01.01`. Modern saved setups already resume through their journey record. The chooser now also lists owned unfinished profiles created outside those setups, so customers can open the original form without knowing its URL or creating another profile.

The list distinguishes saved, expired and empty forms in Persian and English. Resume restores the existing server draft. Restart uses the existing expiry transaction: only saved fields are cleared, the version increases and the same profile survives. Profiles already included in a setup remain in that setup's existing resume flow; submitted, archived and other customers' profiles are excluded.

`GET /api/onboarding/drafts` exposes bounded metadata, with 50-row UUID keyset pages. It returns profile type, optional base-profile name, creation/last-save time and saved/expired flags. Saved field blobs, national identifiers and attachment keys are excluded. UUID order is stable for pagination; it does not promise chronological order for legacy random UUIDs. Retention uses the current shared setting and defaults to seven days. List reads do not clear expired data; opening the form performs the established authorized expiry.

## Recovery and review

Customer/session authorization and final live-session validation protect list reads. Account, session and profile locks retain the established order for draft operations. Unknown, duplicate and malformed query parameters fail validation. Corrupt retention settings return 503 without mutating drafts.

Pagination validates metadata, row order, duplicate identities and continuation cursors before appending. Failed or malformed pages retain accepted rows and retry the same cursor. A denial clears displayed private details. Requests abort on unmount and account-scoped remounts ignore late responses. Failed initial reads keep new-profile creation disabled until recovery; an already known modern setup remains independently resumable.

The new list and dictionary load separately from the shared application dictionary. Existing page structure, invitation handling and personal/company forms are retained. No dependencies or schema migration are added. Review corrected strict test typing and a malformed-response fixture that accidentally supplied the default valid cursor.

## Validation

- Root `pnpm build`: seven tasks pass. Root `pnpm typecheck`: 11 tasks pass.
- Three PostgreSQL HTTP suites: **61 cases pass**, covering the new directory, shared retention and existing onboarding journeys. The new directory covers ownership, privacy, pagination after cursor finalization, restart on the same profile, live/corrupt retention, invalid queries and customer-session eligibility.
- Focused web component/parser and journey tests: **13 cases pass**. Dictionary suite: **68 cases pass**.
- Production Chromium/mobile-Safari wizard, chooser and onboarding-invitation scenarios: **all 86 focused cases pass**. New cases cover saved personal/company fields in both locales, original-profile expiry recovery, pagination retry, initial-read creation blocking and independent modern-setup resume; scoped Axe and mobile width assertions are included.
- Root lint, formatting, OpenAPI, suppressed-error and diff checks pass before publication. Backlog validation covers 1,355 tasks and 116 traceability entries. All 73 existing bundle gates pass without changing limits. Strict security scans 1,492 files with zero findings/errors and all five rule fixtures passing.

The initial broader three-file browser run had 93 passing cases, 15 failures, one interrupted case and 213 cases not run. It encountered failures in unchanged ordering, settings, document-upload and team fixtures and was interrupted. It is not counted as a passing full suite; its failure output is retained in `/tmp/barghsa-profile-recovery-browser.log`. The final run is scoped to the affected wizards, chooser and onboarding invitation flow. Those broader failures remain follow-up work; this report does not establish their baseline cause.

## Deployment and publication

No migration is required. Deploy the API with or before the frontend; the new list endpoint is required before new-profile creation becomes available on the chooser. Existing modern setups remain resumable if the directory is temporarily unavailable.

Published directly to main using Git/GitHub CLI, with local, remote and GitHub branch SHA agreement verified after pushing. Exact-commit CI is read back; pending CI is not described as success. The preceding retention run37031731719 has successful integrity, static security and secret checks while its tests remain running at the last readback.

No PR, scheduler, external supervisor cache/handoff, historical `kanban/loop-state.json`, or generated completion/event history is changed. This batch covers the personal/company directory; electricity, saving and solar continue restoring drafts through their existing order forms. Unrelated unfinished epic criteria remain open.
