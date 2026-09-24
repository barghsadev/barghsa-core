# Advanced electricity review amounts and buyer

Canonical scope: `03-core-business.md#T-03.06.04.05`.

The final advanced-order review identifies the active buyer by name and profile ID and shows each product's payable line total after discount and VAT. The API supplies that line total from its authoritative quote amounts; the review continues to use the server quote digest on submission. The submitted pricing snapshot retains its existing component amounts, from which the displayed line total can be reproduced. Older verification responses still show the profile ID.

Validation: electricity order HTTP integration, the bilingual customer/staff electricity browser journey in all five browser projects, 53 dictionary tests, API and web typechecks, changed-file lint and formatting, API build, OpenAPI contract, and canonical backlog validation. Browser API responses are controlled; the HTTP integration test checks the actual quote calculation and atomic order creation.
