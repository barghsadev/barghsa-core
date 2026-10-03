# Onboarding concurrency CI repair, October 3, 2026

Refund commit `999bd1cf06f673880b859fa7dabe03ec0d5ce33b` failed [CI run 37137503457](https://github.com/barghsadev/barghsa-core/actions/runs/37137503457). The API suite passed 6,140 cases and failed one onboarding concurrency assertion. Its dependent coverage-exemption gate also failed; integrity and both security jobs passed. This run is not recorded as successful.

The test started two requests with one key and a competitor with another key, then assumed the first key must win. HTTP invocation order does not determine database-lock acquisition order. The observed `[409, 409, 201]` result is valid: the competitor created the single journey, and both losing requests were rejected.

The repaired test runs both invocation orders and reads the one committed journey and request key from the database. Every winning request must return that exact public journey with status 201. Every losing request must return 409. A later winner replay must return the same journey, and a later loser retry must still fail. Both cases retain the exact two-profile, one-journey, three-audit assertions. No production behavior, timeout, retry allowance or CI gate changes.

All **33 HTTP cases** in the repaired onboarding suite pass. They run alongside the 57 invoice cases in a final **90/90** API run. Root type checking passes 11/11 tasks and zero-warning lint passes. Formatting and staged diff checks run before the separate conventional CI repair commit. The repair and following invoice batch are published together through one normal push to main, avoiding an extra CI run. Remote CI for the resulting head remains separate from local validation.

```sh
pnpm --filter @barghsa/api test src/invoice/invoice-input-fields.test.ts src/invoice/manual-invoice-http.integration.test.ts src/invoice/invoice-corrections-http.integration.test.ts src/profiles/onboarding-journeys-http.integration.test.ts
pnpm typecheck
pnpm lint
pnpm exec prettier --check apps/api/src/profiles/onboarding-journeys-http.integration.test.ts kanban/batches/2026-10-03-onboarding-concurrency-ci.md
git diff --cached --check
```
