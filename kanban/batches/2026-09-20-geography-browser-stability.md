# Geography pagination and browser stability

Branch: `codex/browser-ci-stability`, based on merged PR #314 at `5fa83cc490ad299f0bce68e48e193f9877157d33`.

Status: implementation and local validation complete; independent review and CI pending.

## Evidence and changes

[Full main run after PR #313](https://github.com/barghsadev/barghsa-core/actions/runs/35527639080) passed unit/security checks but reported two flaky browser cases. The strict flake gate then rejected browser coverage. No coverage-floor failure was reported: coverage collection was blocked by those browser outcomes.

Geography had an actual UI race: its initial empty search debounce reset a fast page-two navigation to page one after 300 ms. The same effect existed in the city list. Both lists now debounce only a changed search value. Regression tests control time at the component boundary and exercise real pagination/search state; both fail on the unchanged main implementation and pass with the fix. Browser tests retain normal application startup and exercise pagination, filters, CRUD, localization and accessibility.

The chargeback test installed a browser clock but later paused it using the test runners wall clock. Small drift could ask Playwright to move backward. It now installs a fixed time and pauses on the same timeline, beyond the entire test timeout, before advancing the polling intervals.

This repairs `07-ui-ux-design.md#T-07.30.02.03` and the province/city management behavior under `02-auth-users-admin.md#T-09.02.01` and `.02`. It does not assert new completion for their broader acceptance criteria. No skips, increased timeouts, retries or lowered gates are introduced.

## Validation

- Production web build and dependency builds pass.
- Ten component tests pass, including pagination recovery, network retry, empty results and stale responses. The two debounce regressions both fail against original main code.
- All 12 related production-browser cases pass five repetitions: 60 passes in 1.7 minutes, zero retries.
- Web typecheck, changed-file lint and formatting pass. Combined component and production-browser coverage passes the existing critical-file floor: 129/133 lines (96.99%) and 97/106 branches (91.51%). Independent review and CI remain required before merge.

## Next

Resume contract draft creation and immutable version history after this repair merges. Keep supervisor history and the scheduler unchanged.
