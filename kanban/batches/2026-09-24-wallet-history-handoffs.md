# Wallet history presentation and invoice handoff

Canonical scope: `07-ui-ux-design.md#T-07.26.01.03`, completing the presentation of the existing wallet history from `04-invoices-wallet-contracts.md#T-04.3.02.02`.

The customer wallet history retains its active-profile isolation, filters and cursor pagination. Each transaction now shows a type icon, a visible state badge, and settled credits or debits in distinct colors. Dates use the saved account timezone. A wallet payment with a valid invoice ID links to that customer's invoice detail; provider and other untyped references remain plain text because they do not identify an invoice. The invoice route enforces its existing customer access checks.

Validation: wallet component tests cover the invoice link, provider reference, signed amount, state, account-timezone date and pagination; related wallet-page tests cover both top-up forms and payment return behavior. Production build, raw typecheck, lint, formatting and backlog checks run before the direct `main` push. GitHub CI runs on the pushed commit.
