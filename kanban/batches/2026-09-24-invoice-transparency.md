# Customer invoice due date and VAT detail

Canonical scope: `07-ui-ux-design.md#T-07.18.03.02`, customer invoice list/detail composition.

The invoice list now shows the API's due date when one exists, formatted in the saved account timezone. Each invoice line now shows the quantity, unit price, net line total and VAT amount already supplied by the API. The table scrolls horizontally on narrow screens, preserving its column labels and RTL layout. Payment, receipt and refund history remains in the existing detail view. No invoice calculation or stored amount changes.

Validation: focused list/detail tests cover due-date visibility and line values in English and Persian. The bilingual deadline browser journey checks the new column labels and accessibility. Workspace build, typecheck, lint, formatting and backlog validation are run before push; GitHub CI runs on the pushed commit.
