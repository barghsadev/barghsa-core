# Refund decision financial snapshot

Canonical scope: the manual wallet and external-bank refund portions of `04-invoices-wallet-contracts.md#T-04.CC.07.01` through `.04`. The wider cross-command review work remains partial.

Staff decisions now load a server-derived financial review before confirmation. It includes invoice facts, current refund state and destination, amount, paid/refunded/reserved/available balances, the available balance after the intended action, linked contracts, applicable second-approval rule, and the intended action. Wallet approval, rejection, cancellation and processing, plus bank-transfer recording and reconciliation, require the exact review hash at the HTTP boundary. The command recomputes it under the transaction locks, rejects stale reviews, and persists the confirmed review in the audit event. Existing refund authorization, step-up, transfer evidence, and separate-reconciler rules still apply.

Validation: focused wallet and external refund HTTP suites, four bilingual Chromium refund journeys, shared/API/web typechecks, generated OpenAPI contract, production web build, lint, formatting, route budgets and canonical backlog validation.
