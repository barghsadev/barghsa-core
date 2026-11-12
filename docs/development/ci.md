# CI execution modes

Ordinary pushes and pull requests run affected workspace tests. The integrity gate includes builds, types, formatting, lint, contracts, the task board, dependency and image scans, static analysis, and secret scanning. Fast-mode results explicitly report the scope of coverage measured.

Manually dispatch CI to run the full release checks. They include coverage from the last released commit, the Chromium production-browser suite, and the strict release policy checks. The existing `CI_FULL_CHECKS` and `CI_FULL_PR_CHECKS` variables can also select full checks for their respective event scopes.

Direct pushes to `main` require **Verify monorepo integrity** on the exact candidate. Create the preflight ref directly at that commit in one push. The first run compares affected packages with the common ancestor on `main`. A stack can fast-forward together after the exact tip passes. Keep diagnostic snapshots on a parent that already contains their board changes because the secret scanner reads all branch history.

The test and application-quality jobs build the workspace before using compiled API and browser fixtures. They run alongside the static, secret and runtime image scans. Combined coverage waits for the two jobs that produce its artifacts. The required check waits for all six results, including the full coverage enforcement result when full CI is selected.

The fast test step uses the successful workspace build from the same job.
For a diff limited to Vitest files under the API, web, or worker source trees,
ordinary documentation, and board updates, it runs `vitest related --run`
in each affected application. The report must include a passing case from
every changed test file. Runtime, shared code, migrations, fixtures, and
configuration changes use Turbo's affected workspace graph and its
`--only --force` test tasks. An unavailable comparison base runs the full
workspace test set. Manual release coverage keeps its separate full scope.

The nightly browser workflow runs Chromium, Firefox, WebKit, Mobile Chrome, and Mobile Safari in eight shards per project. For a release candidate, dispatch `ci.yml` and `browser-nightly.yml` against the same immutable preflight ref. Verify both runs report the intended `headSha` and retain the strict rollup from all 40 browser shards. The Chromium coverage run and the browser matrix provide separate evidence. The release workflow in `kanban/WORKFLOW.md` governs when to enqueue staging after the verified release push.

### Nightly outcome email

After the owner designates the mailbox and approves delivery, configure the
`nightly-browser-delivery` GitHub environment. Store the verified sender and the
dedicated recipient as `NIGHTLY_BROWSER_EMAIL_FROM` and
`NIGHTLY_BROWSER_EMAIL_TO` environment secrets. Store the sending-only key as
`NIGHTLY_BROWSER_RESEND_KEY`, then set the repository variable
`NIGHTLY_BROWSER_EMAIL_ENABLED=true`.

Only the first attempt of a scheduled run sends email. The email includes the
commit, run link, job outcomes and seven-day browser summary. A missing
summary or unsuccessful check requires review. Read
`nightly-browser-email-receipt` for the provider acceptance ID and confirm
receipt in the approved mailbox. If acceptance is unconfirmed, inspect the
provider before attempting any resend. Manual dispatch still produces the
reports for release verification. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)

The web suite pins Playwright 1.65.0 for its driver. This version restores WebKit mouse movement deltas used by the NumberField scrub test. Run the web suite with the same Node.js 24 version as CI when reproducing hosted results. [Playwright WebKit fix](https://github.com/microsoft/playwright/issues/43417)

The nightly Firefox jobs use Mozilla Firefox 159.0, revision 1575 from Playwright's pinned `1.66.0-alpha-2026-11-10` runtime distribution. The default Firefox revision 1572 crashed during axe analysis on both macOS and hosted Linux. The previous stable runtime could not create a context with the 1.65 driver because its download protocol lacks a required parameter. Local reproduction can use `BARGHSA_FIREFOX_EXECUTABLE` to select the same revision. Retire the pin after the default stable Firefox passes the same accessibility cases and the full hosted matrix.

The primary mobile lab measures populated paint in the page once the login control or first populated history row is visible, fonts are ready, and two animation frames have elapsed. The sample also records when Playwright collected the result. LCP, layout shift and blocking time retain their existing observation window and budgets.

Use the [service extraction review](../adr/003-modular-monolith-rationale.md#extraction-review-before-pushing-to-main)
for changes that move a module into a separate service. Record its evidence
with the reviewed batch before the direct push to `main`.

## Local Git checks

The root ESLint flat configuration delegates to the shared TypeScript, Node and
React rules. CI checks the full workspace with `pnpm lint` and checks formatting
separately with `pnpm format:check`.

The workspace install configures Husky in a local Git checkout. If install
scripts are disabled locally, run `pnpm prepare` to enable the hooks. A commit
runs ESLint and Prettier on staged TypeScript and runs Prettier on staged JSON,
Markdown and YAML. Commitlint validates the commit subject against the
conventional types used by this repository. CI and production installs skip
local hook setup and use the hosted checks.

## API contracts

`@barghsa/api-client` exports the OpenAPI `paths`, `operations` and `components`
types for TypeScript clients. Generate the committed API snapshot and client
types together with `pnpm contract:update` after an intentional API change.
Review both outputs with the implementation. CI compares the compiled API
snapshot and checks the generated client types for drift.

Keep existing consumers compatible when removing a field or changing its
type. Introduce a new API version or retain the previous contract through a
documented migration window before removing it.

## Backend test databases

The same Vitest configurations drive CI and local runs. Every tested workspace
extends the shared runner and coverage reporters. The full workflow also checks
changed-source coverage and modified critical files from the previous release.

The CI test job starts the dedicated PostgreSQL service in
`docker-compose.test.yml` through Testcontainers. Locally, set
`BARGHSA_TEST_POSTGRES_COMPOSE=1` when running the same tests to use Compose.
The runner gives each project a new loopback port, a random test password
and temporary storage. It removes that project's containers after the run.
Without the flag, local tests use the standalone Testcontainers setup.

The API test setup starts disposable PostgreSQL and
applies the production migrations to a fresh baseline. The setup disables
connections to that baseline after migration. Each HTTP suite gets its own
database cloned from it, starts the compiled NestJS app, and drops its
database on cleanup. The fixture test starts two clones concurrently and
checks both migration state and isolation of schema and data writes.

For a migration rehearsal, use `BARGHSA_HTTP_FIXTURE_FRESH_MIGRATIONS=1` to
apply migrations to each fresh HTTP fixture database. Lower-level PostgreSQL
tests can use the schema fixture with a unique search path and managed
cleanup. Keep the database URL scoped to a disposable test instance.

## Provider fixtures

The SMTP integration test uses OpenSSL to generate a short-lived certificate
for a loopback TLS listener. Install the `openssl` executable before running
the shared package tests. The fixture trusts only its generated certificate,
uses the existing SMTP allowlist for localhost inside the test, and removes
the certificate and key after setup.

SMS.ir and document storage tests use loopback HTTP fixtures. The staging
payment sandbox test runs the real payment adapter against a disposable local
ledger. These fixtures exercise provider responses without external delivery
or live merchant credentials.

The web Playwright suite requires a loopback application URL. It blocks
unhandled external HTTP requests from the browser, while explicit fixtures can
fulfill synthetic provider URLs. The real API and worker processes launched
by browser fixtures also reject non-loopback sockets. Run staging acceptance
probes through the deployment runbooks with authorized test recipients and
sandbox configuration.

Browser workers that exercise the real API seed a separate disposable
PostgreSQL database. Browser-only journeys keep their fixture data in each
test's isolated context.

## Reusing local builds

Build the required shared, API, worker and web outputs once before their
consumers. After verifying that those outputs match the selected sources, pass
`BARGHSA_TEST_PREBUILT=1` to both native API tests and the production-browser
runner. For example:

```sh
rtk proxy env BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs e2e/onboarding-wizard.spec.ts --project=chromium
```

The flag does not validate freshness. Do not use it with missing or stale
artifacts. Without it, Playwright's `e2e/global-setup.ts` calls the API test
builder, which rewrites shared, worker and API outputs even for a browser suite
using mocked responses. Running that build beside native HTTP tests can remove
modules or expose partially written Nest providers during startup. Such failures
are not evidence of an application circular dependency.

Native and browser checks may run together only when all required outputs are
verified and neither runner will rewrite them. Keep builds sequential with their
consumers, diagnose artifact changes before retrying, and rerun only the affected
cases. Preserve original failed receipts and assertions.
