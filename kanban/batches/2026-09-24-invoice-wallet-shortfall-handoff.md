# Invoice wallet shortfall handoff

Canonical scope: the customer invoice payment journey in `04-invoices-wallet-contracts.md#T-04.2.03.01`, using the existing wallet top-up flow in `04-invoices-wallet-contracts.md#T-04.2.02.01` and `.03`.

When a payable invoice has insufficient available wallet funds, its payment panel now shows the exact shortfall using the shared funding prompt and links to the wallet. The wallet page keeps a return link to the same invoice. The payment quote still controls whether the debit button is enabled, and the wallet page rechecks the active profile before top-up. If the balance is sufficient but payment is unavailable for another reason, the panel does not suggest adding funds.

Validation: 45 wallet-invoice browser cases pass across all five projects, covering both languages, insufficient/funded states, and payment confirmation. Wallet page and funding prompt unit suites pass (18 tests), with web and i18n typechecks, changed-file lint, and formatting.
