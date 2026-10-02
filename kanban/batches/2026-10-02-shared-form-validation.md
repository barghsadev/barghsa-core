# Shared form validation and address settings, October 2, 2026

## Scope and result

This batch builds `07-ui-ux-design.md#T-07.10.01.01` and `07-ui-ux-design.md#T-07.10.01.02`, and implements the shared mechanisms and address-settings adoption for `07-ui-ux-design.md#T-07.10.01.04`, `07-ui-ux-design.md#T-07.10.01.05` and `07-ui-ux-design.md#T-07.10.01.06`. Adoption across other forms, the eleven input adapters in `07-ui-ux-design.md#T-07.10.01.03`, and FormStep remain open. The broader form epic is not complete.

The separate `@barghsa/ui/form` entry exports Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage, FormSubmit, useZodForm and setServerFieldErrors. React Hook Form and its Zod resolver are pinned; UI and web use the existing Zod version. The hook validates on first blur and subsequent changes, preserves schema input/output types, and locks duplicate submissions before asynchronous validation begins. Buttons expose loading and disabled states. Invalid submissions focus the current registered field after controls are enabled, including nested array fields. Server field focus uses the same timing.

Labels, existing help text and mounted error messages retain their accessible associations. Empty reserved error space is hidden from assistive technology and never referenced as a description. Address fields reserve room for feedback so blur validation does not move Save during a pointer click. The address dialog stays within the viewport and scrolls when feedback increases its height.

Customer address creation and editing share the new form state. Province changes clear the city; validated catalogue membership, failed-read recovery and existing API authority checks remain. Required address text, the 500-character limit and the server's ten-digit postal-code rule have localized inline errors. Valid raw input remains after failure while submitted text is trimmed. A top-of-form Alert shows generic failures, with retry retaining the complete draft. Pending submission disables fields, Save and closing controls; repeated programmatic submissions also cannot issue another request.

Address create/edit validation and geography rejection return only public field identifiers through InputFieldException and the existing error envelope. The exception filter never forwards submitted values or raw validator messages. Unknown or malformed feedback falls back to a localized form error. Existing permissions, audit writes, session checks and rollback remain. OpenAPI documents the optional address field metadata. No migration is needed.

## Review and validation

Source review checks input/output typing, error-path mapping, current field refs, submission timing, preserved values, dictionary coverage, API privacy and modal interaction. Review repairs disabled-field focus, stale resolver refs, blur feedback moving the clicked button, and a mobile retry button outside the viewport. The browser fixture now supplies the required branding fields and verifies the actual theme instead of relying on an unused storage key.

Passing evidence covers 261 distinct related unit/integration cases:

- `pnpm --filter @barghsa/ui test` — all 13 files, 121 cases. Shared form coverage includes touched validation, nested field focus, schema transformations, error mapping, retained values, asynchronous duplicate submission and release after failure.
- `pnpm --filter @barghsa/api test src/profiles/addresses-http.integration.test.ts src/common/input-field.exception.test.ts src/common/error-http.integration.test.ts src/profiles/profiles.service.test.ts` — four files, 65 cases. The final address HTTP file also passes its 12 cases after metadata documentation/type repairs. They are included in the 65-case total. Checks cover localized safe errors, unchanged authorization, no rejected-write audit/address changes and arbitrary exception metadata exclusion.
- `pnpm --filter @barghsa/web test src/hooks/useGeographyOptions.test.tsx` — seven cases.
- `pnpm --filter @barghsa/i18n test` — 68 dictionary cases.

`BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web e2e customer-address-selection.spec.ts --project=chromium --project=mobile-safari --workers=2` passes all 16 production browser scenarios. Creation/editing and existing address/profile retry run in English light mode and Persian dark mode, with actual theme/RTL assertions, Axe, mobile bounds, retained drafts, safe feedback, field focus and pending-write interaction. The final Persian mobile screenshot was inspected after the dialog scroll repair.

`pnpm build` passes all seven package builds and UI distribution checks, including the new ESM/CJS/type export consumed with TypeScript 5.9 and 7. `pnpm typecheck` passes all 11 packages. Root `pnpm lint`, `pnpm format:check`, `pnpm check:contract`, `pnpm check:suppressed-errors`, `python3 kanban/scripts/build_backlog.py --check` and `git diff --check` pass. The backlog remains 1,355 tasks and 116 traceability entries. This evidence does not claim the full repository test suite ran.

`pnpm check:bundle` passes all 73 unchanged budgets. Dashboard is 290.85 KB / 300 KB gzip and electricity ordering is 245.45 KB / 255 KB. The strict security gate (`python3 scripts/check-sast.py --report /tmp/barghsa-form-sast.json`, with the established local scanner on PATH) passes all five fixtures and scans 1,508 files with zero findings and zero scanner errors. `pnpm install --frozen-lockfile` passes. The dependency audit returns a valid report with zero high/critical advisories; its existing one low and six moderate advisories remain and make the raw audit command exit nonzero.

## Deployment and publication

Deploy the API with or before the frontend to provide field-specific feedback. The previous API envelope remains compatible and produces the general Alert. This batch adds a browser submission lock; it does not add server request idempotency.

Publication uses direct main through Git/GitHub CLI, with local/remote/GitHub SHA agreement, a clean checkout and exact-commit CI registration read back. New remote checks remain pending until GitHub completes them. The preceding dynamic-array commit `78a1ef4b6d1a41f4294870f59950cfe1c30f5902` passes all five CI jobs in [run37045645959](https://github.com/barghsadev/barghsa-core/actions/runs/37045645959). Existing CI fast mode and its coverage exemption remain unchanged. No PR, scheduler, external supervisor state/handoff, historical `kanban/loop-state.json`, or generated completion/event history is changed.
