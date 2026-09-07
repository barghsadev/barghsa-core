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
active quarantine count. The CI workflow runs it even when preceding tests fail and
uploads its JSON report. Missing or invalid registries and expired critical records
fail the check. Expired non-critical records are reported separately.

Owners use `@user` or `@organization/team`; issue links must be GitHub issue URLs.
Severity is `critical` or `non-critical`. Test paths are normalized repository-relative
paths; duplicate path/name pairs are rejected. Quarantines must start on or before
the current UTC date and expire 1–30 days later. Records remain active through their
expiry date, inclusive.

This report counts registered quarantines. It does not infer flakes from test runner
results: `observed_runtime_flake_count` is explicitly `null`. An empty registry does
not prove a run contained no flaky tests. Automatic production promotion remains
the separate gate described above.

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

The nightly browser workflow is `.github/workflows/browser-nightly.yml`. Each browser project runs in its own job against a locally served production build and disposable test fixtures. It retains failure traces and outcome/quarantine reports for 14 days. The workflow also supports manual dispatch. A local workflow file does not prove that GitHub has executed it; deployment of this configuration and remote run evidence are separate from local verification.
