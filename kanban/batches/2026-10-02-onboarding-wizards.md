# Onboarding wizards, October 2, 2026

## Task coverage

- `07-ui-ux-design.md#T-07.22.02.05`: existing profile-type choice now leads through personal/company stages to review and explicit submission.
- `07-ui-ux-design.md#T-07.28.01.02`: personal identity and address stages, required-field checks, cascading geography, saved drafts and review.
- `07-ui-ux-design.md#T-07.28.01.03`: representative, company, address and document stages; existing uploads; an optional Persian Jalali/English Gregorian registration-date picker.
- `07-ui-ux-design.md#T-07.28.01.04`: summary of the single finalized profile, actual verification/default status and access to the current `/app` dashboard. Combined multi-profile selection/review remains open with `07-ui-ux-design.md#T-07.28.01.01`; the existing chooser still selects one profile type at a time.

## Build and review

Both forms reuse the existing wizard and server draft storage. Continue validates its stage and awaits a successful save; Back also preserves the draft. Explicit draft save permits incomplete fields. Timed autosave, reload and exact-version recovery retain existing behavior. Reloading a conflicting draft returns to the first stage, and final validation returns to the first invalid stage. Inactive fields stay mounted and disabled, preserving selections without exposing them to keyboard or accessibility navigation. Profile-ID changes remount private forms; obsolete submissions cannot navigate a new form to an old completion page.

Personal draft writes use their own bounded field allowlist. Company fields cannot be saved into a personal profile. Ownership, draft status and archive checks run under the same profile lock as version checks, persistence and audit. Final personal submission checks the saved version in its transaction and deletes the draft only after successful persistence. Existing company uploads and version checks are reused. Draft values are stored on the server, without adding browser storage for personal information.

The review stage displays names, identity, locations, addresses and any company documents before the real submission. Both forms reject mismatched, incomplete or unfinalized success receipts. Completion uses the server's owned, finalized profile response for its name, type, verification status and default flag. Completion repairs a missing default for an already submitted profile, preserves current verification decisions, refuses suspended/archived profiles and audits only actual state changes. Repeated completion does not duplicate writes. Audit failures roll back the default assignment.

Review catches and fixes the company form's duplicate blur-save trigger: moving focus to Continue could start a save and disable the button before its click. Timed autosave and save-on-step now handle persistence. Existing browser tests follow the new stages, persist their intended locale and scope attachment assertions to the upload list instead of also matching the hidden review copy. Validation, upload failure, contention and recovery assertions remain intact.

## Validation

- Root build and all eleven TypeScript tasks pass; the final web build/typecheck includes the reviewed changes. Root lint, formatting, OpenAPI contract, suppressed-error, canonical backlog and diff checks pass.
- `pnpm --filter @barghsa/web test`: 211 files and 2,469 cases pass. A final affected run passes 33 cases across four files, included in that suite count.
- `pnpm --filter @barghsa/i18n test`: all 67 cases pass.
- Four related API files have passing evidence for 84 distinct cases: profile writes, draft persistence/contention/privacy, both profile services and legal document HTTP behavior. The final profile/service run passes 70 cases; one added audit-rollback/suspended/archive case passes separately. Earlier failures and repeats are excluded.
- 54 distinct production Chromium/mobile-Safari scenarios have passing evidence on the reviewed build: 48 pass in the final broad run, and the remaining six pass after attachment-selector corrections. Coverage includes both languages, full personal/company journeys, Jalali/Gregorian dates, required fields, normalized identifiers, geography recovery, uploads, autosave and version conflicts, review edits, invalid receipts, default/verification summaries, scoped Axe and mobile width bounds.
- All 69 unchanged route/interaction budgets pass. Strict Semgrep 1.176.1 scans 1,469 files with zero findings/errors; all five rule fixtures pass. Logs use `/tmp/barghsa-onboarding-wizard-*`.

No database migration is needed. Deploy the expanded draft API and completion receipt with or before the frontend. Draft data restores on the existing profile-specific URL; this batch does not add a draft directory or combined profile transaction. Exact-commit CI is read back after publication; fast-mode combined coverage remains an exemption rather than a measured coverage result. Historical supervisor state, generated completion/event ledgers, scheduling and CI settings remain unchanged.
