# Flaky-Test Quarantine Process

**Status:** Adopted
**Date:** 2026-08-24
**Dependencies:** T-01.04.04 (Playwright E2E configuration)

## Policy

A flaky test is treated as a **defect** — not a known limitation. It must be quarantined or fixed. Quarantine is a temporary measure to unblock CI while the root cause is investigated.

## Quarantine Rules

### 1. Quarantine Record

Every quarantined test MUST have a durable record containing:

- **Owner** — the GitHub user or team responsible for fixing the flaky test.
- **Issue link** — a link to the GitHub issue tracking the root cause fix.
- **Expiry date** — a date by which the test must be either fixed or re-quarantined with a new issue. No expiry may exceed 30 days from the quarantine date. If the root cause is still not fixed, the issue must be updated and re-assessed before the expiry.

### 2. Critical Tests in Quarantine

A quarantined **critical** test covers a P0/P1 business flow. Ordinary CI blocks expired critical records. The manual CI release check and production promotion check also block active critical records, even when they have a valid owner, issue and expiry. Restore the required critical coverage before promotion.

### 3. CI Flaky Report

Every CI run produces a flaky-test report:

- The total number of known flaky tests (active quarantine records) is reported as a CI annotation.
- The report appears in the CI run summary. Active valid quarantines remain visible in ordinary CI. A manually dispatched CI release check uses the stricter promotion mode.
- The nightly browser workflow runs Firefox, WebKit and both mobile projects, reports observed outcomes and checks the quarantine registry. Other scheduled quality gates remain tracked in T-05.05.01.

### 4. Quarantine Lifecycle

```
Test identified as flaky
        │
        ▼
[1] Create GitHub issue with root-cause investigation
        │
        ▼
[2] Add quarantine record (owner, issue link, expiry)
        │
        ▼
[3] Mark test as quarantined in the test runner config
        │
        ▼
[4] Upon fix: remove quarantine record, re-enable test
        │
        ▼
[5] If expiry passes without fix: CI blocks critical path
```

## Implementation

### Quarantine Registry

Quarantine records live in a file at `scripts/quarantine-registry.json`. Each record:

```json
{
  "testPath": "apps/web/e2e/payment.spec.ts",
  "testName": "should complete payment flow",
  "owner": "@barghsadev",
  "issueUrl": "https://github.com/barghsadev/barghsa-core/issues/42",
  "quarantineDate": "2026-08-24",
  "expiryDate": "2026-09-23",
  "severity": "critical",
  "reason": "Intermittent timeout in CI due to shared DB state"
}
```

### Diagnose Before Quarantining

A fixture that never completes a required confirmation is a deterministic failure. Assert that the action is blocked, complete the real typed or financial confirmation, and retain the exact request and receipt assertions. After an uncertain write, check current state before allowing a retry and assert that the check did not send the write again.

Calculate locale-sensitive date expectations in the browser being tested. When checking whether a revealed control is fully visible, compare all four intersection edges in physical pixels before rerunning the contrast scan. This avoids treating Safari's fractional edge rounding as a clipped control.

### Adding a Test to Quarantine

1. Confirm the test is genuinely flaky (not a deterministic failure from a code change).
2. Create a GitHub issue describing the failure pattern.
3. Add the JSON record to `scripts/quarantine-registry.json`.
4. In the test runner config, mark the test as skipped with a comment referencing the quarantine issue.

Historical migration tests run the production SQL and journal prefix for the specific
upgrade they assert. Pin the end of that prefix by tag, including any later migration
whose schema is explicitly under test. Use the same prefix for replay. Current
migration-chain tests still run the entire production journal.

### Removing from Quarantine

1. Fix the root cause.
2. Verify the test passes consistently (3 consecutive CI runs).
3. Remove the JSON record from `scripts/quarantine-registry.json`.
4. Re-enable the test in the test runner config.

### CI Reporting

The script `scripts/check-flaky-tests.sh` reads the quarantine registry and reports the
active quarantine count. The CI workflow runs it even when preceding tests fail and
uploads its JSON report. Missing or invalid registries and expired critical records
fail the check. Expired non-critical records are reported separately. Run
`scripts/check-flaky-tests.sh --promotion` against the candidate checkout to
write the strict report required for production approval. Active critical records
fail that check and remain counted in the report.

Owners use `@user` or `@organization/team`; issue links must be GitHub issue URLs.
Severity is `critical` or `non-critical`. Test paths are normalized repository-relative
paths; duplicate path/name pairs are rejected. Quarantines must start on or before
the current UTC date and expire 1–30 days later. Records remain active through their
expiry date, inclusive.

This report counts registered quarantines. It does not infer flakes from test runner
results. `observed_runtime_flake_count` is explicitly `null`. Review actual test
outcomes separately before approving a release.

The browser job separately emits Playwright JSON outcomes and an always-uploaded
count summary. CI enables `failOnFlakyTests`; a failed attempt followed by a passing
retry still fails that job. A real runner fixture verifies this using the actual
browser configuration. Missing/malformed browser results, no successful tests,
runner errors, unexpected outcomes and flakes fail the outcome check. Skipped tests
are reported separately and are not counted as passes. The registry remains the
source for known quarantines across runners; browser counts describe that run only.

## References

- `README.md` — Quality gates section (release-candidate and production-promotion gates reference the flaky-test policy)
- `.github/workflows/ci.yml` — CI pipeline with flaky-test reporting step

The nightly browser workflow is `.github/workflows/browser-nightly.yml`. Each browser project runs in its own job against a locally served production build and disposable test fixtures. Nightly and full CI build the component catalogue with `pnpm --filter @barghsa/ui stories:build` before Playwright discovers tests. The catalogue specs load the generated `packages/ui/story-build/meta.json` during discovery. The nightly workflow retains failure traces and outcome and quarantine reports for 14 days and also supports manual dispatch. Record actual GitHub runs separately from local verification.
