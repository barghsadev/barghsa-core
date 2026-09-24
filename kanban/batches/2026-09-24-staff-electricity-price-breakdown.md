# Staff electricity price breakdown

Canonical scope: `03-core-business.md#T-03.07.02.05`.

The staff electricity review table now shows each product's saved subtotal, discount, net amount before VAT, and VAT beside quantity and unit price. This lets staff compare the components of the submitted quote while deciding whether to approve the preliminary contract. Older snapshots without subtotal or discount show a dash for those values instead of inventing a zero.

Validation: the customer-to-staff electricity journey with a discounted and taxed quote in all five browser projects, staff page tests, 53 dictionary tests, web typecheck, changed-file lint and formatting, and canonical backlog validation. Browser API responses are controlled; the displayed amounts come from the persisted pricing snapshot returned by the staff API.
