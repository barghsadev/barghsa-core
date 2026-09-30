# Online wallet top-up financial review

Canonical work: `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04`, applied to online wallet top-up initiation (`T-04.2.02.01`). The cross-command review work remains partial.

The customer now sees the server-confirmed profile, exact IRR amount, current per-top-up limit, gateway payment source and delayed wallet-credit rule before opening the payment gateway. A new pending intent requires the reviewed hash at the HTTP boundary and recomputes it under the profile and versioned limit locks. Changed limit policy rejects a stale review before any ledger insert or gateway start. The pending transaction and audit retain the confirmed review; an idempotent retry verifies its stored hash, while preexisting pending intents remain resumable.

The bilingual dialog and review validator load only when the customer starts a top-up. Production route budgets remain enforced, with separate interaction budgets for the review code.

Validation: 55 online top-up API tests, 51 wallet-page tests, API/web builds and typechecks, shared export checks, lint, generated OpenAPI contract, all 60 route and interaction budgets, formatting, and backlog validation pass locally. Main CI will run after the push.
