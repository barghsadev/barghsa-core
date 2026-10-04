# Consultation configuration HTTP regressions — October 4, 2026

Status: repaired, independently reviewed and locally verified; direct-main publication and exact-commit CI are read back separately.

## Scope and cause

CI run `37222225979` failed three successful configuration-write cases after the earlier consultation configuration batch added a third work type. The API correctly returned normalized consultation defaults, but these older tests expected only ticket and verification-case values. The same run passed 6,304 other API cases, all 3,334 web cases and all 87 dictionary cases; the combined-check failure followed the failed test job.

This follow-up changes six expected stored/returned values in `config-write-http.integration.test.ts`. Response targets and escalation default to disabled consultation values; assignment defaults retain an unset team with round-robin strategy. The legacy two-domain request bodies remain unchanged, verifying backward-compatible normalization.

Exact response/storage equality, audit content, global version increments, revoked grants, no-write snapshots and audit-failure rollback checks remain. Independent review verifies these assertions and the defaults against the existing normalizers. No additional kanban task is marked complete.

## Validation

- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api exec vitest run src/admin/config-write-http.integration.test.ts` — initial reproduction: 44 pass, three fail; final: all 47 pass in 10.56 seconds.
- `pnpm exec eslint apps/api/src/admin/config-write-http.integration.test.ts` — pass. Formatting, canonical backlog and staged diff checks pass before publication.
- The already verified API build is reused. Product source is unchanged; no additional build, browser run or security scan is required for these fixture-only changes.

External initial/final logs, source-bound validation and publication evidence: `/Users/majid/.local/state/barghsa-manual-batches/consultation-config-http-regressions/`.

## Remaining scope

No product deployment, migration, dependency, CI setting, generated queue/ledger, historical loop-state or supervisor-state change is included. Exact-commit CI remains separate from local verification. The next selected feature batch is customer solar postal shipment forms and matching staff guidance/issue forms.
