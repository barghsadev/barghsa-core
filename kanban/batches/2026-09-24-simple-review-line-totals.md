# Simple electricity review line totals

Canonical scope: `03-core-business.md#T-03.05.02.03` and `03-core-business.md#T-03.05.04.05`.

The simple-order preview and final review now show each product's payable line total from the server quote. When discount or VAT applies, the customer also sees the subtotal and adjustments, so the pre-adjustment subtotal cannot be mistaken for the amount due on that line. The reviewed quote digest and order submission remain unchanged.

Validation: simple order HTTP integration, the customer-to-staff electricity journey across five browser projects with nonzero discount and VAT, web typecheck, changed-file lint and formatting, and canonical backlog validation. The browser uses controlled API responses; the HTTP integration test verifies the quote field against the built server.

CI follow-up: [run 35996530022](https://github.com/barghsadev/barghsa-core/actions/runs/35996530022) found three simple-order unit failures because the line quantity called a formatter absent from that test's existing mock. The quantity now uses its original rendering; the affected unit file and Chromium journey pass locally after the repair.
