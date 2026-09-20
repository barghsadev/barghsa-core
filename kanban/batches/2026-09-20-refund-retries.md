# Durable refund retries

Branch: `codex/refund-retry-batch`, based on merged PR #312 at `4eea6d198341581d1b3f8af2e7a9b9ddaf5ca5fb`.

Status: implementation and local validation complete; independent review and GitHub CI remain.

## Scope

`04-invoices-wallet-contracts.md#T-04.4.01.07`: durable manual wallet-refund processing and bounded retry worker. The remaining `.02` pending approval-time ledger criterion is not implemented by this batch. Automatic contract obligations and external bank execution remain separate work.

## Behavior

The API validates finance permission, step-up, profile and current approval policy, then atomically records Processing, its audit and a unique retry job before attempting credit. A successful immediate attempt still returns Completed. A failed attempt rolls the financial work back to a savepoint, commits Failed with a safe error code, and schedules another attempt. Responses include attempt count, limit, due time and exhaustion status.

The registered worker polls every 15 seconds. Both API and worker enforce the same per-refund due time. Five attempts use exponential backoff starting at one minute; exhausted requests remain Failed and send one localized in-app alert to each current finance recipient. Generic job monitoring separately reports worker availability failures.

Processing authorization is a durable command. Session expiry after that command commits does not cancel it. A request whose session expires before the command commits cannot create a job. Each money-moving attempt still checks current finance authority, exact canonical approval binding, policy and profile state, holding the relevant locks through commit. Audit entries identify the authorizing staff user and distinguish the worker executor.

The shared server-side credit helper preserves exact money, idempotency, profile/wallet identity, archival checks and optimistic balance updates. Credit, refund completion, the database-owned invoice counter, invoice state/audits and the owner notification commit together. A crash before commit leaves the durable job available; an advisory lock and row locks serialize duplicate worker/API attempts.

Migration 0136 adds the retry table, due-time index, attempt bounds, immutable job identity/history, terminal guards and update timestamps. Its journal timestamp follows the existing production journal monotonically. Older Failed rows without a processing job require an explicit authorized process request; migration does not invent historical processing authority.

External refunds still require recorded transfer evidence and distinct current finance reconciliation. They cannot enter the wallet retry queue. Customer notices remain in-app only. An exhausted job cannot be silently reset by repeating the process API call.

## Validation

- API, worker and database builds/typechecks pass.
- Combined wallet service, PostgreSQL credit and refund suites: 172 tests pass, including all 40 refund cases.
- New worker integration cases cover durable failure, due-time enforcement, exponential delays, five-attempt exhaustion, localized finance-only alerts, safe error codes, duplicate suppression, committed-request recovery, concurrent workers, current authority/policy/profile changes, and both sides of the session-expiry authorization boundary.
- Existing audit/notification rollback tests now assert durable Failed plus zero financial changes, followed by a due retry and one completion.
- Changed-file ESLint, database snapshot validation and generated OpenAPI comparison pass.
- Full pinned Semgrep scan: five fixtures pass, 829 files, zero findings/errors.

- Direct production-migration refund tests: 22 pass, including schema export, immutable authority, attempt bounds and deletion guards. Worker process and retry runner: 11 pass. Shared source suite: 976 pass, plus the new monitoring contract test. Localization: 50 pass.
- Changed/critical source coverage passes against main `4eea6d19`: API critical 95.71% lines / 92.10% branches; shared database critical 97.26% / 98.47%; worker refund runner 100% / 100%. Other changed-source groups pass their existing floors.
- Canonical backlog and audit requirement checks pass. No coverage floor was lowered.

## CI repair

The first PR run exposed shared-package Node tests being collected by Vitest and a race with the shared build deleting its output. Shared Vitest now includes source tests only; both package test commands run the existing bucket tests through Node afterward. Package task dependencies wait for the shared build. Validation: 977 Vitest tests and 16 native storage/CLI tests pass, including real MinIO; the task graph confirms test depends on the shared build. The monitoring test formatting is corrected. These changes require a fresh exact-HEAD review.

## Before merge

Obtain independent exact-HEAD review and require all active GitHub CI checks. Keep the historical supervisor arrays and paused scheduler unchanged.
