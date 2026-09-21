# Contract acceptance and signing financial review

Built on `codex/contract-financial-review`. PR #333 merged as `04bc9ef180e2e1811054d6ebd064f15f57cc4030` after exact-head approval and all five checks in run35584995473. This branch is being rebased onto that verified merge before publication.

Scope: continue `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` for customer contract acceptance, staff signing requests and staff/customer signed-copy recording. Show the current published terms, frozen activation conditions, initial invoice, refund policy and exact document checksums; bind each action to the authoritative review. Acceptance and signing themselves take no payment. Other financial commands remain open, so the canonical tasks remain partial.

Current status: backend and bilingual UI built. HTTP acceptance, signing request and signed-copy commands require the current financial review hash. The transaction rebuilds the snapshot under the exclusive profile lock and records it in audit and idempotent results. The dialog keeps the captured snapshot through password/retry flows, rejects malformed or mismatched reviews, displays published terms, activation requirements, invoice obligations, refund policy and selected document checksums, and blocks confirmation while account time is unavailable. Long confirmations scroll within the viewport.

Validation: 53 real HTTP cases across contract review, signing, activation and document suites pass. Thirty focused UI cases pass. Sixteen production browser cases across desktop and mobile Chromium pass in English/Persian, including unchanged hash/idempotency through step-up. Shared foundation has 15 boundary tests and four adapter tests. API/web types, scoped lint, dependency builds, production build, OpenAPI generation and canonical backlog validation pass. Final changed-source coverage, remaining browser projects, independent exact-head review and CI remain. No completion claim or PR yet.

The reader requires the caller to acquire the exclusive profile lock before actor, contract, invoice and document locks. Reviewed access paths now opt into the exclusive profile lock; other existing access remains unchanged. Preserve existing session, step-up, publication, profile permission and idempotency boundaries. Preserve immutable contract/signature evidence and do not introduce a migration merely to duplicate existing idempotency result and audit storage.

Scheduler state is unchanged. Canonical tasks remain partial until the other financial command families are completed.
