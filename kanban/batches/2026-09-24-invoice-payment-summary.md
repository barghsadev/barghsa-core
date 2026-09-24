# Customer invoice payment summary

Canonical task: `07-ui-ux-design.md#T-07.26.01.04`.

The viewed customer invoice now has a bilingual payment summary before its activity history. It shows exact IRR total, confirmed paid amount and remaining amount, a green accessible progress bar, and the invoice payment state. Percentage calculation uses `bigint`, so invoice amounts above JavaScript's safe integer range stay exact. Cancelled invoices do not display an amount due; credit adjustments do not present a payment action. The existing wallet-payment review stays within the summary and remains enabled only when its server quote confirms sufficient balance and the current invoice state permits payment.

Validation: focused component and invoice-detail tests cover exact amounts, both languages, payable and nonpayable states. The existing wallet-payment browser journey checks the summary before and after settlement, wallet balance gating and accessibility. Production build, raw typecheck, lint, formatting and kanban checks run before the direct `main` push. GitHub CI runs on the pushed commit.
