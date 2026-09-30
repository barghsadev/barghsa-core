# Document lists and template editor recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt shared ListPage composition for customer/staff document results, the staff document-template catalogue and the staff destruction queue. Embedded business-document results receive the same recovery behavior.

Other list adoption, legacy filter URL serialization and broader search/sort remain open, keeping the all-list parent partial. Richer document-row metadata/actions in `07-ui-ux-design.md#T-07.25.01.04` and related document UI tasks are not marked complete. The retention-policy form is unchanged.

## Behavior and review

Document recovery retains accepted rows, selected review, upload file inputs and staff explanations. Local retry requests the exact failed cursor with identical filters and profile scope; explicit Refresh requests the first page. Pages append with ID deduplication. Equivalent filter objects no longer cause redundant reads; an actual document-scope change resets selected work and ignores abandoned responses.

Template catalogue and selected-detail reads recover independently. List retry preserves metadata drafts, retained version files, new file inputs and version explanations without rereading detail. Opening/cancelling creation no longer reloads the list. Explicit Refresh still reloads both resources. A changed latest version removes obsolete retained-file choices and pending confirmation while preserving new files and explanations, and displays a translated notice. Publishing and saving selected work wait for valid detail.

The destruction queue retains accepted rows/counts and approval reasons through temporary failures. Fresh data that removes management authority or changes the selected manifest's eligibility closes approval and confirmation. Existing irreversible confirmation, step-up and server authorization remain intact.

Permission denial clears retained data and open work within the denied resource. Queue denial invalidates racing detail/download responses and late completion callbacks. Template-detail denial leaves an independently authorized catalogue available. Malformed list envelopes recover as read errors. Review covers request identity, cursor retry, response abandonment, file-input mounting, independent recovery, authority changes and selection eligibility.

Recovery labels are translated in Persian and English. Named regions, accessibility assertions, keyboard interaction and mobile overflow checks pass. Customer, staff and template Persian mobile Safari renderings are visually inspected.

No API, database, permission-model, dependency, scheduler or CI changes are included.

## Validation

Evidence logs: `/tmp/barghsa-document-list-*.log`.

Final root build/typecheck and root lint pass. The full web suite passes 1,250 tests in 124 files. All thirty related focused tests pass, including eleven new recovery cases and nineteen existing document/template regressions. All 53 dictionary tests pass. All 64 route budgets, contract and suppressed-error checks pass. Final formatting, canonical backlog and diff validation pass.

Sixteen new bilingual recovery scenarios and eight existing document upload/review scenarios pass across Chromium and mobile Safari, for 24 browser cases without failures or retries. Existing scenarios verify upload submission uses the displayed revision and staff review keeps the same revision through password verification. New scenarios verify exact cursor recovery, draft/file preservation, independent template recovery, permission clearing, destruction eligibility, accessibility and mobile layout.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web test`, `pnpm --filter @barghsa/i18n test`
- `pnpm --filter @barghsa/web exec vitest run src/components/document-list-recovery.test.tsx src/components/DocumentsWorkspace.test.tsx src/pages/AdminDocumentTemplatesPage.test.tsx`
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/web exec playwright test document-list-recovery.spec.ts documents.spec.ts --project=chromium --project=mobile-safari --workers=2`
- Final web typecheck and targeted formatting cover the browser fixture and edited progress files.
- `python3 kanban/scripts/build_backlog.py --check`, `git diff --check`

## Publication

The preceding support queue batch is published as `279f98f14543ef3461e43cfca69dd0917bea60e0`; CI run `36788682899` passes all five gates under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.

This document batch is published as `2934bcadfc23ab1837dc92456a4b87e6fc1b0a2b`; CI run `36790376542` passes all five gates under the existing temporary fast mode. Combined-coverage success remains an exemption, not measured coverage.
