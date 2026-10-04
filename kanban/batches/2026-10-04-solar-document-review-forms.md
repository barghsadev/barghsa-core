# Solar staff document-review and guidance forms — October 4, 2026

Status: built, independently reviewed and locally verified; direct-main publication and exact-commit CI are read back separately.

## Kanban scope

This batch applies `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` to the staff solar document journey. Domain context is `03-core-business.md#T-03.12.01.04`, `03-core-business.md#T-03.12.02.03` and `03-core-business.md#T-03.12.02.04`. Shared form infrastructure already exists; wider form adoption remains broader than this batch.

- Existing guidance and document controls use separate shared forms with touched validation, linked field feedback, focus and bilingual help. Rejection reasons accept up to 1,000 characters; additional-document descriptions accept up to 2,000. Approve/advance do not require irrelevant reason text. Guidance accepts 4,000 characters per language, paired suggestion lists of up to 30 entries and 200 characters per translated entry. Trimming and empty-line handling retain existing serialization.
- Staff API validation emits only known editable field identifiers. Missing rejection reasons and missing additional-document preview descriptions now have owned feedback. Structural, unknown-key and protected revision/hash/decision failures remain general, without echoing submitted data. Current request capability checks precede field projection; authoritative transactional checks remain.
- Lazy validation, review preparation and captured confirmation have separate submission guards and loading feedback. Exact document revisions and set-review hashes remain captured. Step-up retries send the same command, duplicate attempts are blocked and late previews cannot populate a different selected request.
- Failed writes retain valid drafts. Guidance saves verify the complete normalized receipt; missing, mismatched or uncertain results block replay until a successful reload. Reload failures retain the draft and lock. Guidance saves and denial handling preserve independent document work; document denial clears selected work while guidance remains available.
- Existing queues, independent cursors, file preview, per-file decisions, set-stage review, replacement lineage and customer/postal journeys remain.

## Review and corrections

Independent review found a stale preview callback that could use the rejection's 1,000-character message for a later additional-document error. The callback now reads the current field mapper, with a regression covering both preview and confirmation errors after switching intent.

Live HTTP testing found a fixture cleanup error: role permissions are stored as JSON text, and restoration accidentally serialized that text again. Cleanup restores and verifies the original raw value in `finally`; revocation/no-field-disclosure and no-write assertions remain.

Production Axe checks found an invalid `group` role on the guidance form. The named group now uses a div wrapping the native form, with bilingual source regressions. No accessibility rule is excluded. Test timing repairs await lazy validation, deferred focus and settled confirmation responses; they retain the original draft, privacy, loading and duplicate-prevention assertions. Initial outcomes are preserved externally.

Mobile Safari exposed a real submission defect: touched validation inserted suggestion errors between pointer press and release, moving Save by 63 pixels. Event traces showed the release/click targeting the form instead of Save, with no submit. Guidance fields reserve the actual localized error-message space so validation cannot move the button. The unchanged browser focus assertions verify the repair. A shared-helper focus experiment did not address the cause and was removed; shared UI primitives remain unchanged.

## Validation

**68 distinct related unit/API/dictionary cases and 38 production browser cases pass**, excluding reruns.

- API source: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/solar/solar-documents.controller.test.ts` — 22 pass. Live HTTP: the same command selecting `src/solar/solar-documents.integration.test.ts` — three pass. Coverage verifies exact limits, field ownership, permission precedence, generic protected failures, zero service calls and unchanged persisted state/config versions/audits after invalid writes, alongside the existing document lifecycle and 100+1 paging.
- Web: `pnpm --filter @barghsa/web exec vitest run` selecting `src/pages/solar-document-review-forms.test.tsx`, then the pair `src/pages/solar-list-recovery.test.tsx src/pages/solar-queue-navigation.test.tsx`, then `src/pages/admin-solar-queues.test.tsx` — final runs pass nine, twenty and three cases, respectively. All 32 page cases have passing evidence after the layout repair. `pnpm --filter @barghsa/web exec vitest run src/lib/solar-document-form.test.ts` — ten pass.
- Dictionary: `pnpm --filter @barghsa/i18n exec vitest run src/solar-document-forms.test.ts` — one pass, checking both languages. Original agent tool output is retained without rerunning unchanged helper/dictionary tests for logging.
- Production browsers: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/solar-document-review-forms.spec.ts e2e/solar-journey.spec.ts e2e/solar-staff-list-recovery.spec.ts e2e/solar-staff-query.spec.ts --grep 'solar (document review forms|guidance rejects|files|requests|request moves)' --project=chromium --project=mobile-safari --workers=2 --reporter=line,json` — final 38 pass. Twelve new cases cover both locales/themes, protected confirmation, owned/general failures, receipts, stale selection and independent denial. Existing journey, queue URL/recovery, scoped Axe and mobile bounds remain. Captures use portable per-case output paths.
- English light Chromium and Persian dark mobile Safari captures are inspected and preserved externally. The final layout source cases pass nine/nine; the shared UI experiment and its checks are explicitly superseded, with no shared UI diff.
- Root build — seven successful tasks; final affected frontend build — four successful tasks. Root types — eleven successful tasks; final web types and lint pass. Reviewed OpenAPI changes affect only required rejection reasons and conditional additional-document descriptions; endpoint sets are unchanged. Contract/suppression checks and all 84 existing budgets pass. Final strict security passes five fixtures over 1,636 files, zero findings/errors. Formatting, canonical backlog and staged diff checks precede publication.

External logs, initial outcomes, source-bound validation, captures and publication evidence: `/Users/majid/.local/state/barghsa-manual-batches/solar-document-review-forms/`.

## Deployment and remaining scope

No migration or new endpoint is required. Deploy the API with or before the frontend for owned server feedback; client validation and general failure handling remain safe with older responses. Existing transactional authority, step-up, file revisions, set-review hashes and audit writes remain.

Solar physical progress, postal tracking and financial confirmations were already built and are outside this batch. No dependency, CI setting, canonical generated queue/ledger, historical loop state, scheduler or supervisor-state change is included.
