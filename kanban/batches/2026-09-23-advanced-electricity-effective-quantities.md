# Advanced electricity effective quantities

Canonical scope: `03-core-business.md#T-03.06.02.03` and `03-core-business.md#T-03.06.02.04`.

Advanced ordering now decides whether a bundle is eligible for preview using the quantities it actually sends to the server. When the mandatory green rule locks the green field, a stale manual green amount in a restored draft cannot trigger a zero-quantity preview or let the customer advance. A failed preview shows its error without continuing to say that calculation is in progress.

Validation: advanced-order UI tests cover a restored green-only draft and a structured green-limit preview failure. Web tests, build, typecheck, lint, formatting, and backlog checks passed.
