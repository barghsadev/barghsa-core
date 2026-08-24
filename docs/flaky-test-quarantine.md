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

A quarantined **critical** test (a test covering a P0/P1 business flow) **must not silently allow production promotion**:

- The CI pipeline must fail or block the release gate if any critical test is in quarantine and the expiry has passed.
- The production promotion gate (see `README.md` — Production promotion gate) checks for quarantined critical tests and blocks promotion if any are found without a current, valid quarantine record. This enforcement is policy-defined; the automated gate implementation is tracked in T-05.04.01.

### 3. CI Flaky Report

Every CI run produces a flaky-test report:

- The total number of known flaky tests (active quarantine records) is reported as a CI annotation.
- The report is displayed in the CI run summary but does not block the PR pipeline by itself — blocking is handled by the production promotion gate.
- The README's Scheduled quality gates define a nightly flaky-test report job. The CI schedule trigger for nightly runs is tracked in T-05.05.01.

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

### Adding a Test to Quarantine

1. Confirm the test is genuinely flaky (not a deterministic failure from a code change).
2. Create a GitHub issue describing the failure pattern.
3. Add the JSON record to `scripts/quarantine-registry.json`.
4. In the test runner config, mark the test as skipped with a comment referencing the quarantine issue.

### Removing from Quarantine

1. Fix the root cause.
2. Verify the test passes consistently (3 consecutive CI runs).
3. Remove the JSON record from `scripts/quarantine-registry.json`.
4. Re-enable the test in the test runner config.

### CI Reporting

The script `scripts/check-flaky-tests.sh` reads the quarantine registry and reports the
flaky count. The CI workflow calls this script after the test step.

## References

- `README.md` — Quality gates section (release-candidate and production-promotion gates reference the flaky-test policy)
- `.github/workflows/ci.yml` — CI pipeline with flaky-test reporting step