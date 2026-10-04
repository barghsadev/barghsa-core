# Solar customer shipment and staff postal forms — October 4, 2026

Status: built, independently reviewed and locally verified; direct-main publication and exact-commit CI are read back separately.

## Kanban scope

This batch applies `07-ui-ux-design.md#T-07.10.01.02`, `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06` to the existing customer and staff solar postal journey. Domain context is `03-core-business.md#T-03.12.03.01`, `03-core-business.md#T-03.12.03.02`, `03-core-business.md#T-03.12.03.04`, `03-core-business.md#T-03.12.03.05` and `03-core-business.md#T-03.13.01.03`. Wider shared form adoption remains broader than this batch.

- Customer shipment controls use shared touched validation, linked owned feedback, focus and bilingual help. Courier accepts 100 characters, tracking number 200, and sending date must be a valid calendar day no later than the current UTC day. Optional receipt images remain scoped to the current request, profile and uploader.
- Staff guidance and decision reasons have independent forms and drafts. Guidance accepts 4,000 characters per language, a 2,000-character destination, 1,000-character contact details and up to 30 paired originals with 200 characters per translated entry. Postal incomplete/not-received and final reject/close decisions require a reason up to 1,000 characters; received/approve remain usable without irrelevant reason text.
- API feedback exposes only known editable field identifiers. Structural, unknown-key and protected decision/hash failures remain general. Current staff capabilities precede field projection; future-date and receipt-image feedback follows authoritative customer/state checks. Existing locks, step-up, review hashes, audit writes and notifications remain.
- Submission guards cover lazy validation, preview and confirmation. Commands capture normalized values and exact hashes; step-up retries retain those commands. Request/profile and selection generations fence late reads, uploads, resolver completions and previews. Local reserved message space keeps touched feedback from moving mobile submit controls.
- Shipment saves require a fresh authorized read matching the captured courier, tracking number, exact calendar-day text and optional image. A lost or malformed response locks replay until matching shipped/received state is proven. An older editable read cannot prove that an uncertain command failed. Guidance verifies the full normalized receipt and preserves independent decision work; denied writes are not restored merely by a successful read.
- Owned failures retain valid drafts. Denied or unavailable postal reads, malformed fresh reads and denied/missing-request shipment writes withdraw private request and image state. Uncertain transport/server writes retain the authorized draft under lock. Existing queue paging, URL selection, tracking, contract forms and customer/staff workflows remain.

## Review and corrections

Independent review rejected timestamp-prefix matching as shipment proof: the API returns calendar-day text, and verification now requires that exact value. Review also repaired image choices after authorized recovery, privacy withdrawal after unavailable/malformed reads, and late malformed-response handling across scope changes.

An additional review found that an editable read could unlock an uncertain shipment write. Recovery now remains locked until exact saved-state proof. Only a well-formed definitive API rejection clears the pending command while retaining the draft. The lost-response regression verifies that older editable and mismatched shipped reads cannot trigger a second write.

The existing customer unit test now awaits lazy validation before inspecting the write, retaining its exact body, saved status and form-removal assertions. Its timestamp fixture uses the API's calendar-day representation. The older browser journey supplied incomplete nullable postal fields, a null guidance string and an obsolete confirmation receipt. Those fixtures now match current responses; every original journey, shipment and hash assertion remains. Initial outcomes are retained externally.

## Validation

**86 distinct related unit/API/dictionary cases and 36 production browser cases have passing evidence**, excluding reruns.

- API source: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/solar/solar-postal.controller.test.ts` — 25 pass. Live HTTP: the same command selecting `src/solar/solar-postal.integration.test.ts` — six pass, including the original lifecycle. Tests cover owned fields/bounds, generic protected errors, zero invalid-write effects, live grant revocation, step-up and authority before semantic feedback.
- Web: `pnpm --filter @barghsa/web exec vitest run` selecting `src/components/solar-postal-forms.test.tsx`, `src/pages/solar-postal-forms.test.tsx`, `src/components/SolarPostalPanel.test.tsx`, `src/pages/admin-solar-queues.test.tsx`, `src/pages/solar-list-recovery.test.tsx` and `src/pages/solar-queue-navigation.test.tsx` — all 43 distinct cases have passing evidence. The initial run passed 42/43; the affected old customer suite then passed three/three. Helper: the same command selecting `src/lib/solar-postal-form.test.ts` — 11 pass. Dictionary: `pnpm --filter @barghsa/i18n exec vitest run src/solar-postal-forms.test.ts` — one pass.
- Production browsers: `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test e2e/solar-postal-forms.spec.ts e2e/solar-postal-tracking.spec.ts e2e/solar-staff-list-recovery.spec.ts e2e/solar-staff-query.spec.ts e2e/solar-journey.spec.ts e2e/solar-final-rejection.spec.ts --grep 'solar postal customer form|solar postal staff forms|public tracking update|failed tracking reads|late tracking review|solar postal queue|solar postal URLs|solar request moves|postal-reviewed solar request' --project=chromium --project=mobile-safari --workers=2 --reporter=line,json` — 34/36 initially pass. After the fixture repair, the same runtime selecting `e2e/solar-journey.spec.ts --grep 'solar request moves'` passes both affected cases. No cases skip or retry into a flaky outcome. Eight new cases exercise both locales/themes, exact recovery, independent drafts and protected decisions; the 28 existing cases retain tracking, queues and final decisions. Scoped Axe and mobile bounds remain enabled.
- English light Chromium customer and Persian dark mobile Safari staff captures are inspected and preserved externally. The final eight production source hashes match the independently reviewed build.
- Root build — seven successful tasks; final affected frontend build — four successful tasks. Root types — eleven successful tasks. Lint, formatting, contract/suppression checks and all 84 existing bundle budgets pass. The OpenAPI diff changes only the two existing postal/final review request bodies for conditional reasons; endpoint sets and other contract sections remain unchanged. Strict security passes five fixtures over 1,640 files with zero findings/errors. Canonical backlog validates 1,355 tasks and 116 traceability entries; final staged checks precede publication.

External logs, initial outcomes, source-bound validation, captures and publication evidence: `/Users/majid/.local/state/barghsa-manual-batches/solar-postal-forms/`.

## Deployment and remaining scope

No migration or new endpoint is required. Deploy the API with or before the frontend for owned server feedback. Existing authority, snapshot hashes, step-up and audits remain.

Postal tracking, construction progress, contract and financial workflows were already built and are outside this batch. No dependency, CI setting, canonical generated queue/ledger, historical loop state, scheduler or supervisor-state change is included. Other forms and the broader shared adoption tasks remain open.
