# AI audit identifiers and CI regression repair

Date: October 2, 2026. Manual batch under the user's direct-main workflow.

## Task scope

- `05-notifications-documents-ai.md#T-05.22.03`: repair audit lookup for validated structured request, agent and conversation identifiers.
- `05-notifications-documents-ai.md#T-05.22.05`: preserve sensitive content redaction and its category/size/depth bounds while repairing identifier handling.
- Regression coverage for the existing customer knowledge and staff test-chat APIs under `05-notifications-documents-ai.md#T-05.21.01`. This repair does not certify the whole AI domain.

## Evidence and delivered change

GitHub run `36926419822` failed one customer knowledge-chat audit assertion among 5,829 API cases. The controller awaited its audit, but the lookup by request ID returned no row. The general redactor can interpret numeric segments of an otherwise valid UUID as bank data and replace them with `[REDACTED]`. Random UUID fixtures made the failure intermittent.

The fixed numeric UUID fixture reproduces that HTTP failure, and the new audit unit regressions fail on the old implementation. The repaired audit serializer preserves only valid UUID values in top-level input fields named `requestId`, `agentId` and `conversationId`, using the same Zod UUID validation as the endpoints. All other input fields, nested values, malformed identifiers and output fields still use the full redaction policy. Identifier digits no longer produce false redaction categories. Existing limits of 30 entries/items, 4,000 text characters, five levels and 120-character keys remain enforced. No prompt redaction rule, API contract, database schema or CI exemption is relaxed.

The knowledge HTTP regression now uses a deliberate numeric UUID and verifies the exact stored request ID, profile/slot, message and categories alongside the existing source isolation and idempotent replay behavior. Audit unit coverage checks UUIDv4/v7 preservation, credential/bank/national-ID redaction in both input and output, invalid/nested/free-form/output identifier handling, and existing bounds.

## Validation and review

- The pre-fix deterministic reproduction fails four of ten cases, including the exact missing-audit-row assertion from CI. This is diagnostic evidence, not a passing validation.
- All 22 affected cases pass: `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/ai-agents/ai-audit.test.ts src/ai-agents/ai-knowledge-chat-http.integration.test.ts src/ai-agents/ai-test-chat-http.integration.test.ts src/ai-agents/ai-prompt-redaction.test.ts`. Customer/staff HTTP suites use real migrated PostgreSQL and a local provider fixture.
- Root build/typecheck/lint/format, generated contract, suppression checks, all 66 unchanged route/interaction budgets, backlog and diff whitespace pass. Strict security passes five fixtures and scans 1,409 files with zero findings/errors.
- Review verified the exemption is limited to validated top-level input identity fields and that redaction/depth/entry limits remain unchanged for every other value. The original failure was repaired in product code with a deterministic regression, rather than relying on a CI rerun or skipping the assertion.
- No browser rerun is required for these backend-only changes. The preceding reply batch retains its 216 affected-case and 76 browser-scenario evidence.

## Publication and remaining work

Publication uses a conventional direct-main commit with local/origin/GitHub SHA, clean worktree and exact-commit CI registration read back. New CI remains pending at publication. The preceding reply commit's security, integrity and secret jobs pass while its test job remains running at review time. Historical supervisor state, handoffs and completion ledgers remain unchanged; existing CI fast mode and coverage exemption are preserved.

The next product batch continues the remaining customer/staff kanban work. Full public support names/avatar images, unavailable related-record destinations and other unfinished domain requirements remain open.
