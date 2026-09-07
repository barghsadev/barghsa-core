# Payment recovery amount review

Status: repaired and locally verified.

ZarinPal recovery used parseInt on inquiry amounts. Values such as `250000.5`, `250000IRR`, and `250000e1` therefore matched a requested 250000 IRR session if the callback also matched. Recovery now accepts only positive decimal digit strings or safe integer numbers and compares the entire value exactly. Malformed or different values cannot attach an authority. The existing unique-match and callback requirements remain.

Fifteen new cases cover malformed, fractional, prefixed, suffixed, unsafe, absent and valid numeric/string values. The red run had six failures and 63 passes. After repair, all 99 gateway, top-up service and real-PostgreSQL top-up integration checks pass. API types/lint, formatting and diff review pass. Provider fixtures are controlled responses, not a live ZarinPal certification. Existing financial records and external attempts were not rewritten or reconciled.
