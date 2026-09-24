# Customer electricity order line prices

Canonical scope: `03-core-business.md#T-03.07.04.02`.

Customer order detail now labels the stored order-line amount as the subtotal before discount and VAT. When the line matches the submitted pricing snapshot, it also shows that line's saved discount and VAT and the resulting payable amount. An absent or inconsistent legacy snapshot leaves the subtotal visible without presenting a made-up breakdown. This keeps the post-submission view aligned with the reviewed quote.

Validation: customer order-detail tests, the customer-to-staff electricity journey with nonzero discount and VAT in all five browser projects, web typecheck, changed-file lint and formatting, and canonical backlog validation. The browser uses controlled API responses; the displayed components come from the saved pricing snapshot already returned by the order-detail API.
