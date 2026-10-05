# Province, city and bulk-import native forms

Status: built, reviewed and locally verified. Direct-main publication, exact-commit CI, staging deployment and Telegram confirmations are recorded separately outside the checkout.

## Kanban scope

This batch improves the existing province interface for `02-auth-users-admin.md#T-09.02.01` and city interface for `02-auth-users-admin.md#T-09.02.02`. It advances `07-ui-ux-design.md#T-07.10.01.02`, `#T-07.10.01.04`, `#T-07.10.01.05` and `#T-07.10.01.06`; those global form tasks remain partial.

- Province/city creation and editing validate bilingual names, the existing 100-character limit and editable status. Owned localized feedback links to controls and receives keyboard focus after they unlock.
- City import validates tab-separated names and the existing 200-row limit. Safe API `cities` feedback belongs to the raw-row input; unsupported feedback retains the generic localized alert.
- Raw drafts survive validation and command rejection. Synchronous ownership covers deferred validation, command submission and closing; save buttons show progress. Changed catalogue readiness or targets retire validation before a write. Keyed editors retire drafts when their target changes.
- Permission checks precede public field metadata. Existing CSRF, successful response predicates, versioned/audited mutations, import atomicity, inactive records, conflict handling, pagination and read recovery remain.

## Review and verification

Root source review covers the complete changed implementation and regression assertions. The retained recovery helper now waits for actual asynchronous write dispatch without removing its original assertions. Initial HTTP checks used stale prebuilt API output; rebuilding and rerunning verifies the actual public-field response. A successful-import assertion was corrected to the existing complete `{ imported, cities }` acknowledgement. The first cold frontend assertion now waits for rendered validation instead of the dialog's already-initial focus. These failures and repairs are preserved externally.

- API: **75 cases pass** across controller authorization/field feedback, unchanged geography service behavior and five real PostgreSQL HTTP cases. Invalid names/import rows and oversized imports produce no geography mutations or mutation audits; the complete valid import is persisted in its selected province.
- Frontend: **58 cases pass** across nine new native-form cases, retained recovery/pagination and response boundaries. They cover bilingual focus, retained raw values, duplicate submission, import limits, safe owned/unowned feedback and readiness retirement.
- Dictionaries: **112 cases pass**.
- Production browser checks: **48 cases pass** on rebuilt assets in Chromium and mobile Safari, with zero retries. Eight new cases cover creation/editing/import feedback, raw drafts, duplicate writes, keyboard focus, viewport bounds and zero dialog accessibility violations. Forty retained CRUD, pagination and light/dark recovery cases pass.
- Root build/type checks, scoped ESLint, contract and suppression checks pass. All **85 unchanged bundle budgets** pass. Strict SAST scans **1,787 files**, with zero findings/errors and all five rule fixtures passing. Formatting and canonical backlog validation precede publication.
- Original Persian desktop status, Persian mobile import and English mobile name-feedback captures were inspected. Each contains the complete dialog and action buttons; selected Persian captures provide release attachments. The notes disclose their sample data.

Evidence is in `~/.local/state/barghsa-manual-batches/geography-native-forms`. Release **v0.1.2** uses the shared login version and required `./deploy/staging/deploy.sh`, followed by confirmed Persian notes and screenshots in Barghsa Release Radar.

No existing geography engine is recounted. No schema/migration, dependency, CI configuration, deployment/notifier, generated backlog, historical loop state or supervisor state changes are included.
