# Contract acceptance and signing financial review

Prepared on `codex/contract-financial-review` from PR333 HEAD `d2c71e4674b7f600c3b6e58b20aa232734308428` while its CI runs. Rebase onto the verified PR333 merge before publishing this branch. PR333 is not yet merged.

Scope: continue `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04` for customer contract acceptance, staff signing requests and staff/customer signed-copy recording. Show the current published terms, frozen activation conditions, initial invoice, refund policy and exact document checksums; bind each action to the authoritative review. Acceptance and signing themselves take no payment. Other financial commands remain open, so the canonical tasks remain partial.

Current status: shared parser and transaction reader foundation built. Fifteen shared boundary tests and four adapter tests pass; shared/API dependency builds, API types and canonical backlog validation pass. The reader is not connected to any route or mutation yet. Transaction/profile lock integration, hash confirmation and persisted replay/audit evidence, controllers, bilingual UI, real database/HTTP/browser tests, final coverage and independent review remain.

The reader requires the caller to acquire the exclusive profile lock before actor, contract, invoice and document locks. Current access helpers use shared profile locks; the reviewed paths must explicitly opt into the exclusive lock before integrating the reader. Preserve existing session, step-up, publication, profile permission and idempotency boundaries. Preserve immutable contract/signature evidence and do not introduce a migration merely to duplicate existing idempotency result and audit storage.

Keep scheduler state unchanged. Do not open a second active PR before PR333 has merged.
