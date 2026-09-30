# Contract cancellation financial review

This batch advances `04-invoices-wallet-contracts.md#T-04.CC.07.03`–`.04` for staff contract cancellation. The existing API already binds a saved cancellation decision to a fingerprint of the current contract and invoice balances, stores the snapshot with the intent, and rejects changed finances before execution.

The staff prepare and execute dialogs now show the captured contract, profile, version, service, paid and returned amounts per invoice, available refund, each selected refund destination, and total promised return in the shared bilingual financial review layout. The review stays captured through step-up and retries. The UI still refuses execution when the current fingerprint differs from the saved decision.

The bilingual contract cancellation and customer-request browser fixtures now provide explicit operating contexts and verify the review and end-to-end cancellation handoff. The wider cross-command review tasks remain partial.

Validation: focused component tests, both English and Persian Chromium cancellation and customer-request flows, web typecheck, lint, formatting, production build, bundle budgets, and canonical backlog validation.
