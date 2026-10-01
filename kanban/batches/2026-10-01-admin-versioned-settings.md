# Admin versioned settings and previews, October 1, 2026

## Kanban scope

This batch completes `07-ui-ux-design.md#T-07.30.01.03` and `07-ui-ux-design.md#T-07.30.01.04`. The shared VersionedSettingsCard serves branding's existing immutable draft, activation and history APIs. ConfigPreviewCard compares branding settings, VAT rate proposals, document-template metadata and version file selections.

The next batch should assess config audit history, `T-07.30.01.05`. OTP-based sensitive-action step-up, `T-07.30.01.06`, remains open. Existing password confirmation does not complete that requirement. Broad settings-form adoption and remaining domain journeys are separate work.

## Behavior and review

Branding opens read-only with explicit Edit, current active version, saved date, author and expandable version history. Save creates a new immutable draft. Restore as draft copies a superseded version through the existing save endpoint; it requires separate confirmation and activation. Activation verifies the exact draft ID, version and configuration before reporting success or refreshing the application theme.

Current and history reads must be fresh and coherent before commands proceed. Failed reads retain local edits, prepared uploads and pending review while pausing commands. Changed saved settings withdraw obsolete confirmation and require explicit draft reset. Permission denial clears private work; request generations and authorization epochs discard late completions. Save receipts require a new ID, the next version and the reviewed configuration. History rejects duplicate IDs/versions, malformed status, ambiguous active/draft rows and a draft older than another version.

The preview card stacks on narrow screens and compares columns on wide screens. Branding previews remain local and include published defaults before the first saved version. VAT previews show the current rate and pending fractional rate/schedule without submitting. Template previews display metadata and file selections as text; they do not execute arbitrary template HTML. Existing upload, download and domain mutation workflows remain authoritative.

Review fixes strict status validation, the initial default preview, duplicate document-preview landmark names and repeated inner landmarks. Current/Draft panels use named groups inside each uniquely named preview region. Tests retain full Axe checks. Persian mobile light/dark previews were inspected.

## Validation

The full web suite passes 1,728 cases. The final affected run passes 423 cases across five files, including two additional cases. This supplies passing evidence for 1,730 distinct web cases; it is not a separate full-suite run of 1,730. All 53 dictionary cases pass.

All 44 distinct final production browser scenarios pass across Chromium and mobile Safari. They cover both languages/themes, version review, exact save/activation receipts and retries, rollback, failed-history recovery, permission denial, existing branding theme/validation journeys, VAT recovery, template queue recovery and both VAT/template preview adoptions. Axe and page bounds pass. Failed, interrupted and duplicate runs are excluded from the count.

Final root build/types, root and affected lint, formatting, contract/suppression checks and all 64 route budgets pass. Backlog validation passes 1,355 tasks and 116 traceability entries. The pinned strict security scan passes all five rule fixtures and scans 1,338 files with zero findings or scanner errors. Diff checks pass. This batch adds no API, database, migration or dependency changes.

## Publication

The preceding settings-framework commit is `1a6a5292b1a9012c684e7f8913c7bf18716afc09`. Its CI run [36857420764](https://github.com/barghsadev/barghsa-core/actions/runs/36857420764) passes all five jobs under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage. The older member-detail run `36855980923` is cancelled with a combined-coverage failure; it is not green. The older directory run `36853179568` is also cancelled.

This batch is committed and pushed directly to main after local validation. Remote SHA, clean worktree and exact-commit CI registration are read back after publication. No PR is created. Historical supervisor state, external handoffs, scheduler and CI gates remain unchanged.

## Commands

- `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`
- `pnpm --filter @barghsa/web exec vitest run`; final affected rerun with `src/lib/branding-settings.test.ts src/pages/branding-settings.test.tsx src/pages/admin-boundaries.test.tsx src/pages/vat-recovery.test.tsx src/pages/AdminDocumentTemplatesPage.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs versioned-settings.spec.ts branding-theme.spec.ts branding-validation.spec.ts vat-recovery.spec.ts document-list-recovery.spec.ts --grep 'version review|VAT|branding editor|appearance rejects|template queue' --project=chromium --project=mobile-safari --workers=1 --max-failures=2`
- `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`
- Pinned strict security scanner with the existing external wrapper using `--timeout 60 --jobs 2`, retaining all rules, targets and exclusions
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`
