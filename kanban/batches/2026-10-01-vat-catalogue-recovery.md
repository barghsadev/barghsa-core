# VAT rate and product override catalogue recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: shared ListPage composition for VAT category-rate history and product-override history. Both APIs return complete collections; no artificial pagination is added. The parent remains partial for other list pages and broader filter/search/sort work. Existing VAT domain behavior is already built and is not counted as newly completed.

## Behavior and review

Rate history, override history, product choices and account timezone recover independently. Retained tables stay mounted while reads fail; local retry does not refetch unrelated resources. New rate and product-override drafts preserve percentages, category, selected product/rate, scheduled date and wall time. Rate creation remains available through unrelated product/override failure, while override decisions require the relevant reads. Missing selected choices remain visible and prevent saving until replaced.

Frozen confirmation has local recovery controls and waits for valid relevant reads and timezone. A changed referenced rate/window, product identity/type or existing product override invalidates the decision while preserving its draft. New category-rate confirmation also watches the category history it may replace. Product display-name changes and collection ordering do not invalidate valid work. An already ended or removed target closes an obsolete ending editor. Permission denial clears private financial rows, editor fields and confirmation and wins races against older responses. Cancelled or obsolete completion cannot erase newer work or report success.

Timezone retry preserves the local scheduling draft. A genuinely changed accepted timezone invalidates confirmation and requires choosing the scheduled date again; percentage, selection and wall time remain available. Correcting the selected date or wall time clears the stale invalid-date message. Initial dates wait for a verified timezone instead of presenting a fallback as verified. Existing account-zone conversion, DST-gap rejection, history-window precedence, CSRF, exact command bodies and step-up remain supported.

The existing catalogue hook is renamed from `useAiCatalogueResource` to `useCatalogueResource` so VAT can reuse its permission/abort boundary. Knowledge and policy pages change import/symbol names only, and their related tests are included. No API, database, dependency, permission-model, scheduler or CI configuration changes are included.

## Validation

Final root build, types, formatting, root lint with affected-file lint, contract/suppression checks, backlog/diff checks and all 64 route/interaction budgets pass. The final related web run passes 418 cases: seventeen VAT recovery cases, twenty-one knowledge/policy recovery cases and 380 admin-boundary cases. All 53 dictionary cases pass. The pinned security scan passes all five rule fixtures and scans 1,305 files with zero findings or scanner errors. The final production browser run passes all 24 distinct cases across Chromium/mobile Safari after the last behavior correction. The unchanged full web suite is not rerun; the preceding main commit's CI is green.

Review and browser verification corrected three issues before publication. The first production run exposed legacy assertions expecting one combined failure and native-div keyboard scrolling that failed in Safari. Assertions now acknowledge two independent errors; both histories use the shared horizontal ScrollArea and its keyboard viewport. Persian screenshot inspection caught the native time field reversing hour/minute order in RTL Safari. Its direction is now LTR while labels remain Persian and wall-time submission is unchanged. Final review replaced an overly restrictive percentage regex with native form validity: `.5` remains valid while unsupported precision cannot submit. A regression case covers both.

Evidence logs: `/tmp/barghsa-vat-recovery-*.log`. New scenarios cover bilingual retained financial drafts, independent retries, local frozen-confirmation recovery, withdrawn products, timezone recovery and permission denial. Existing VAT creation, scheduling/DST and history/override flows are included. Persian scheduling, override and rate-draft rendering is inspected. Failed or repeated cases are excluded from final distinct totals.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/vat-recovery.test.tsx src/pages/knowledge-policy-recovery.test.tsx src/pages/admin-boundaries.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs vat-recovery.spec.ts vat.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Final affected browser cases: same harness with `--grep='VAT timezone|VAT schedules'`
- Final affected units after the direction adjustment: `pnpm --filter @barghsa/web exec vitest run src/pages/vat-recovery.test.tsx`
- Pinned external scanner: `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-vat-recovery-static-security.json` with its environment on PATH
- Targeted ESLint/Prettier; `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`

## Publication

The preceding knowledge/policy batch is published as `f566832afb195a4ce91289aeab8075b63ab95351`; CI run `36825440239` passes all five gates under the existing temporary fast mode, including the previous AI catalogue fixture repairs. Combined-coverage success remains an exemption, not measured coverage.

This VAT batch is committed and pushed directly to main after review and the checks above. Remote SHA and CI registration are read back after publication. No PR is created. The broader parent remains partial.
