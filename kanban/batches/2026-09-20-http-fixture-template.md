# Reuse a migrated baseline for isolated HTTP tests

Branch: `codex/http-fixture-template`.
Status: PR #310 merged at `d56de886c52c9f193cfde60eefe56b0b3aa15aff` after independent approval and all active CI checks passed.

## Why this batch

The user requested less redundant work and shorter CI waits. PR #308 spent 23m55s in its test job, including 22m12s in the API suite. Many HTTP tests recreate a database and apply every production migration before each test. This maintenance of `01-platform-infrastructure.md#T-01.04.03` removes that repeated setup before continuing the already implemented external refund batch. It does not mark a new product task complete or change the generated queue.

## Change

API test setup starts its existing disposable PostgreSQL container, migrates a fresh template once, and disables connections to that template. Each HTTP fixture clones the baseline into its own database and starts its own API process. Test data, schema mutations and server state remain isolated. A new real-PostgreSQL test verifies parallel clones, independent data/schema changes, production refund triggers and finance roles, and refusal to connect to the template.

Templates are created anew on each test run and disappear with the test container. They are not persisted across branches or runs. Fixtures using a different database URL still run migrations normally. `BARGHSA_HTTP_FIXTURE_FRESH_MIGRATIONS=1` restores per-fixture migration for troubleshooting or comparison. Product migrations, test selection, coverage thresholds and worker/database package setup are unchanged.

## Validation

The initial template run passed 58 tests across the isolation test, auth delivery and profile writes in 37.18 seconds. The same two existing suites passed 57 tests in 58.67 seconds with fresh migrations. This is a local comparison, not a measured GitHub speedup. API build, typecheck and changed-file lint pass. The full API suite passes all 5,183 tests across 309 files in 407.38 seconds on the PR #308 baseline. After rebase onto merged PR #309, the API rebuild and 26 refund/template tests pass. Independent review approved exact HEAD `9e3d06002416132503439ef485adb599a24a6f91`: [durable review](https://github.com/barghsadev/barghsa-core/pull/310#issuecomment-5749942819). [CI run](https://github.com/barghsadev/barghsa-core/actions/runs/35511992353) passed all five active checks. The test job took 13m27s versus 18m25s in the preceding PR run; runner variation means this is not a controlled benchmark. PR fast mode did not collect coverage or run full browser tests.
