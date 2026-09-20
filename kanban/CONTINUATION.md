# Development continuation status

Checked September 20, 2026 against CI-verified commit `faf9a2de2825e2bb829699aec2802d68c2d1f2a8` on `codex/audit-fixes`.

## Local development

PR #305 is merged at `0b768cf1`. PR #306 is merged at `999a1f44`, tracked in [batch status](batches/2026-09-20-wallet-history.md). PR #307 merged [refund storage and reservation limits](batches/2026-09-20-refund-storage.md) at `e326bdbe`. PR #308 merged [invoice activity and customer history](batches/2026-09-20-invoice-activity.md) at `460c6d5f`. PR #309 merged [manual wallet refunds](batches/2026-09-20-wallet-refund-workflow.md) at `d8df7986`. PR #310 merged the [migrated HTTP test baseline](batches/2026-09-20-http-fixture-template.md) at `d56de886`. PR #311 merged the [invoice-history coverage follow-up](batches/2026-09-20-invoice-history-coverage.md) at `25a85079`, with independent approval and all five active CI checks passing. PR #305 passes all five CI jobs, including full browser validation, unit coverage thresholds, security scans and combined changed/critical source coverage. [Verified run](https://github.com/barghsadev/barghsa-core/actions/runs/35498578584). The backlog validator passes for 1,355 tasks and 116 traceability entries. The audit validator passes for all 322 historical claims, 301 saved PRs and 58 historical skips.

Historical claim acceptance is 219 verified, 54 partial and 49 deferred. The other 1,033 canonical tasks are outside that historical audit population. They are not automatically proven unimplemented or ready. Reuse existing code and acceptance evidence before choosing a new build.

Wallet history and cumulative receipt settlement were merged in PR #306. Refund storage and reservation limits were merged in PR #307. Invoice aggregation and the remaining customer history displays merged in PR #308. Manual wallet refunds and second-person approval merged in PR #309; use the batch record for exact scope and evidence.

The merged wallet refund batch covers `.04`, the wallet portion of `.06`, and part of `.02`. Next are external reconciliation, remaining lifecycle behavior and retry processing: `04-invoices-wallet-contracts.md#T-04.4.01.02` and `.04` through `.07`. Reuse the merged schema and counter ownership, and implement guarded transitions, atomic wallet refunds, dual approval, external reconciliation and retry behavior. The automatic contract-return tasks remain dependent on the contract workflow. This is a manual continuation order, not a supervisor assignment.

Use the consolidated workflow: build a coherent dependency-related batch, run focused checks as needed, and perform one combined review and final validation. The 54 partial and 49 deferred historical claims retain their exact unmet requirements in [acceptance](../audit/acceptance-closure.json) and [skipped-work handoff](../audit/skipped-work-handoff.md). Do not restart completed repairs or silently waive owner decisions.

## Automatic loop

Automatic restart is not ready:

- PR #305 was verified merged at `0b768cf1` on September 20. The baseline blocker is resolved.
- A read-only remote ref check found no `kanban-state` branch. The default local durable-state cache is also absent on this machine.
- A read-only GitHub API check confirmed PR #304 is closed without merging and PR #305 is merged. A complete live loop-owned PR inventory remains necessary before automatic restart.
- `kanban/loop-state.json` is the September 1 historical snapshot. Its 308 completion claims are not current acceptance. Its apparent next tasks include already verified repairs.
- `audit/reconciled-loop-state.json` is the earlier blocked import of saved history. Its 263 merged identities and empty acceptance-verification array are import provenance, not the current audit ledger or dispatch authority.

Before enabling automation, reconcile current PR and state history against the acceptance ledger, and explicitly recover/bootstrap durable state under [STATE-PROTOCOL.md](STATE-PROTOCOL.md). Keep the configured scheduler paused throughout reconciliation. Do not directly edit completion arrays to skip partial or deferred work.

The user authorized repeated manual build/review/merge batches on September 20 and withdrew the prior token ceiling. This does not restart the scheduler or alter legacy supervisor state. Partial task criteria remain explicit in the batch record.

The [external bank refund batch](batches/2026-09-20-external-refunds.md) is based on PR #311 and locally validated: 35 refund tests, 36 refund/template checks, and 115 related wallet/approval cases pass. Refund coverage is 96.53% lines / 89.42% branches; the full security scan passes. Its pull request is the source for live review and merge status. After its verified merge, continue `.07` durable retry processing and the remaining `.02` lifecycle criteria. Failed retries and pending approval-time ledger entries are not yet implemented; automatic contract obligations remain separate.

PR [#312](https://github.com/barghsadev/barghsa-core/pull/312) is merged at `4eea6d19` after independent approval and all five active checks passed. The active [durable refund retry batch](batches/2026-09-20-refund-retries.md) is based on that merge. Durable failure scheduling and the registered retry worker are implemented. All 172 focused wallet/refund tests pass; package coverage closure, independent review and CI remain. Pending approval-time ledger entries remain a separate `.02` criterion.

PR [#313](https://github.com/barghsadev/barghsa-core/pull/313) merged durable refund retries at `b7bc57b4` after final exact-HEAD approval and all five active CI checks passed. This supersedes earlier retry-pending status above. Current work is the [approval-time refund transaction batch](batches/2026-09-20-refund-pending-ledger.md), based on that merge. Automatic contract obligations remain separate.

PR [#314](https://github.com/barghsadev/barghsa-core/pull/314) merged approval-time refund transactions at `5fa83cc4` with independent approval and five successful checks. The preceding full main run exposed chargeback clock and geography pagination browser failures; the [browser stability follow-up](batches/2026-09-20-geography-browser-stability.md) takes priority before contract drafts/versioning. Contract storage and a versioned lifecycle are missing dependencies for automatic refund obligations.

PR [#315](https://github.com/barghsadev/barghsa-core/pull/315) merged the browser stability repair at `7f4cb2c1` after exact-HEAD approval and all five checks passed. Current work is [contract drafts and immutable versions](batches/2026-09-20-contract-drafts.md). Staff draft APIs and storage are in validation; customer visibility and full lifecycle transitions remain outstanding.

PR [#316](https://github.com/barghsadev/barghsa-core/pull/316) merged contract draft storage and staff version APIs at `f27e982e` after independent approval and all five checks passed. The active [review and customer acceptance batch](batches/2026-09-20-contract-review-acceptance.md) must publish an exact version before exposing it to customers. Signature/document, activation and automatic refund dependencies remain outstanding.

PR [#317](https://github.com/barghsadev/barghsa-core/pull/317) merged contract review, published-version reads and customer acceptance at `50620a01` after exact-HEAD approval and all five checks passed. The full main run after #316 passed all 830 database assertions but failed its provider migration teardown's 10-second timeout. The [cleanup follow-up](batches/2026-09-20-provider-proof-cleanup.md) gives only that hook a 30-second budget; all 837 current database tests pass locally with coverage. PR #318 CI passed all 837 database tests but exposed a separate 150ms notification lease test expiry. The follow-up now controls only the heartbeat timer while retaining the real database, renewal and competing-worker checks; all 460 worker tests pass with coverage. After its updated review and merge, continue E-05 document lifecycle as the prerequisite for contract signatures. UI, signature/activation, amendments, cancellation and automatic refund obligations remain outstanding.

PR [#318](https://github.com/barghsadev/barghsa-core/pull/318) merged both CI test repairs at `420a69d6` with independent approval and all five checks passing. Current work is the [document lifecycle backend](batches/2026-09-20-document-lifecycle.md), based on that merge. Local validation passes 111 API, seven database and nine permission tests, builds/types, migration snapshot and OpenAPI checks. Changed-source coverage, independent review and CI remain. Earlier pending-review/merge language above is historical.

The full main run after #317 also passed all five checks: https://github.com/barghsadev/barghsa-core/actions/runs/35534595745. The full run after #318 is still running; its test suite has passed.
