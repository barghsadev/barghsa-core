# Document-template authoring — v0.1.4

This batch completes shared-form adoption for document-template metadata creation/editing and multipart file-version publication, under `05-notifications-documents-ai.md#T-05.10.03`. The existing template UI and extraction/version engines are reused. Global shared-form tasks `07-ui-ux-design.md#T-07.10.01.02`, `#T-07.10.01.04`, `#T-07.10.01.05` and `#T-07.10.01.06` remain partial.

## Changes

- Linked English/Persian field validation and native focus preserve raw metadata and version drafts.
- File validation checks retained membership, combined count, duplicate names, extensions and upload-size limits before confirmation.
- A synchronous parent owner prevents competing forms, duplicate submissions and edits during confirmation or dispatch. Confirmation shows the captured command.
- Metadata and version receipts must match the captured command before drafts reset. Unconfirmed HTTP/transport/receipt outcomes retain drafts and trigger authorized reads; resubmission requires deliberate return to editing.
- The API returns allowlisted public field identifiers after permission and step-up checks, without submitted values.
- Root SemVer is `0.1.4`; login uses the shared version. Release notes are Persian.

## Validation and review

Evidence: `~/.local/state/barghsa-manual-batches/document-template-authoring/`.

- `pnpm --filter @barghsa/web test src/pages/AdminDocumentTemplatesPage.test.tsx src/lib/document-template-form.test.ts src/lib/template-catalogue-query.test.ts src/components/document-list-recovery.test.tsx`: 27 cases pass.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/documents/document-template-http.integration.test.ts src/documents/document-template-extraction.test.ts src/common/input-field.exception.test.ts`: eight cases pass, including real database/storage upload, extraction, retained files and historical downloads.
- Production browser checks: eight new authoring cases and eight retained document-query cases pass across English/Farsi, Chromium/mobile Safari. Both English/Farsi login version cases pass in Chromium. Accessibility and viewport bounds are checked.
- API and production web builds, root TypeScript checks, changed-file ESLint/Prettier, OpenAPI compatibility, suppression policy, all 85 unchanged bundle budgets and canonical queue validation pass.
- Strict SAST: 1,788 files, zero findings/errors; five rule fixtures pass.
- Focused source review covered submission ownership, denied/obsolete callbacks, raw-draft preservation, multipart capture, API error privacy and receipt handling. Repairs clear stale captured actions on a changed version and guard malformed file receipts.
- Earlier failed checks were repaired: one nullable access, a fixture using an incorrect validation code, old refresh assumptions, modal-hidden role selection and a browser file replacement attempted before validation unlocked. Related checks were rerun; failures are preserved in evidence.

## Limits and release

Saved-state recovery requires explicit user review and does not automatically replay an unkeyed command. Upload content validation and extraction remain server-owned. No domain engine, schema/migration, dependency, CI gate or historical supervisor state was changed.

Normal direct-main push, detached deployment and Telegram confirmation are recorded separately in external publication/queue receipts. Deployment uses the exact pushed commit through `./deploy/staging/deploy.sh`; CI is informational for staging.
