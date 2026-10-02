# Customer wizard draft retention, October 2, 2026

## Scope and result

Finishes the admin-configurable, default-seven-day retention criterion of `07-ui-ux-design.md#T-07.22.01.02` across personal/company onboarding, simple/advanced electricity, saving and solar as one related batch. Existing step saves and draft restoration were built in the preceding wizard batches. A general legacy draft directory remains separate; this batch does not claim that directory or unrelated unfinished requirements complete.

The existing retention setting now governs all six forms. Valid values are integers from 1 to 365; absence defaults to seven. Reads use the live setting without a process restart. Invalid stored values return 503 and preserve the draft. Expiry is lazy on the next authorized read, based on the last persisted update; this is not scheduled physical deletion of every unopened draft.

Admin electricity settings identify the control as customer form draft retention in Persian and English. `/api/admin/config/wizard-draft-ttl` provides the general GET/PUT surface. The existing electricity endpoint, configuration key, versions and audit chain remain compatible. Writes still require catalogue-edit permission, CSRF and fresh step-up, update the global configuration version and persist the audit transactionally. OpenAPI includes the new endpoint and preserves the legacy endpoint.

## Recovery and review

Electricity, saving and solar remove only the authorized user/profile/mode's expired draft. Personal/company onboarding clears saved fields, increments the draft version and audits the expiry under the owned DRAFT profile lock. A version tombstone prevents old tabs from reusing a deleted draft version. Reads cannot clear another user's, archived or submitted profile. Profiles, submitted orders, address history and completed setup records are retained.

Expired onboarding writes and versioned final submissions return a conflict until the saved draft is reloaded. Reload returns empty fields with the retained version, resets the wizard URL to stage one and allows fresh edits. Empty company documents normalize to `[]` so an empty draft does not trigger an unnecessary autosave. Existing completed-profile submission and document sealing behavior remains intact; independent legacy submissions without a draft version keep their existing contract.

Review repaired a user/session lock-order conflict exposed by concurrent draft saves. Draft operations now lock user, session and profile in the authentication order and recheck the current session before commit. Failed expiry audit writes and sessions expiring during audit persistence roll back draft changes. Review also repaired duplicate geography setup, the expiry fixture's restored idle deadline and a mobile assertion that counted settings-selector option groups as private form fields. Assertions now check the actual removed form and TTL input.

## Validation

- `pnpm build`: seven root tasks pass; the final onboarding recovery changes also pass `pnpm --filter @barghsa/web build`.
- Seven related PostgreSQL HTTP files have passing evidence for **101 distinct cases**: retention, admin configuration, profile writes, onboarding journeys, legal documents, saving orders and solar requests. The initial 98-case selection had two failures; after review, the full 31-case profile-write file passes and all 18 final retention cases pass, including the three added concurrency/session/audit cases. Failures and repeated executions are excluded from the total.
- `pnpm --filter @barghsa/web test src/hooks/useOnboardingDraft.test.tsx src/lib/onboarding-profile.test.ts src/lib/onboarding-journey.test.ts`: all 21 cases pass. `pnpm --filter @barghsa/i18n test`: all 67 cases pass. No unrelated full unit suite is claimed for this batch.
- Production Chromium/mobile-Safari checks have passing evidence for **68 distinct scenarios**: all 60 onboarding scenarios and the final eight admin scenarios. Both locales, conflict reload, retained versions, URL restart, save-before-leaving, uploads, final receipts and existing combined setup work. The admin control passes scoped Axe and mobile width checks. The final admin-only rerun passes all eight cases after correcting the option-group assertion.
- Root typecheck (11 tasks), lint, format, OpenAPI, suppressed-error and diff checks pass. Backlog validation covers 1,355 tasks and 116 traceability entries. Strict security scans 1,488 files with zero findings/errors and five passing rule fixtures.
- All 73 existing bundle gates pass without changing limits. Dashboard is 299.38 KB/300 KB; electricity ordering is 254.25 KB/255 KB.

## Deployment and publication

No database migration is required. Deploy the API with or before the frontend for the new configuration endpoint and onboarding expiry handling. Existing configured electricity retention immediately applies to the other forms, including older saved drafts; otherwise seven days applies. Uploaded objects remain subject to their existing storage lifecycle.

This batch is published directly to main using Git/GitHub CLI, with local, remote and GitHub branch SHA agreement checked after pushing. Exact-commit CI is read back after publication; pending or cancelled CI is not reported as success. At build time the preceding saving/solar run37028598243 still had tests running, with integrity, static security and secret scanning successful.

No PR, scheduler, external supervisor cache/handoff, historical `kanban/loop-state.json`, or generated completion/event history is changed. Continue with the next bounded related batch from the canonical epic acceptance criteria.
