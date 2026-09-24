# Invoice return after online wallet top-up

Canonical scope: customer top-up and invoice payment handoff in `04-invoices-wallet-contracts.md#T-04.2.02.01` and `04-invoices-wallet-contracts.md#T-04.2.03.01`.

The invoice-to-wallet return link introduced in the previous batch was lost after an online gateway redirect, because the provider returns with only the top-up order ID and authority. Before leaving for the gateway, the wallet page now saves the invoice ID in tab storage under the exact top-up transaction ID returned by the API. On the provider return, the wallet route restores that invoice link only for the matching top-up. The reference expires after 24 hours. Payment confirmation and invoice access remain server-authorized; no payment state is inferred from the stored reference. The bank receipt path continues to use the direct invoice query link.

Validation: the wallet page and return-reference unit suites pass (19 tests), and all 50 wallet-payment browser cases pass across five projects. Web typecheck, changed-file lint and formatting, and the canonical backlog check pass locally.
