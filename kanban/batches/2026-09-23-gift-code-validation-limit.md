# Gift-code validation protection — September 23, 2026

Canonical task: `03-core-business.md#T-03.90.06`.

Code-bearing electricity previews and saving quotes/submissions now share a PostgreSQL-backed limit of 12 validation attempts per authenticated user over five minutes. Invalid guesses count even when checkout rolls back; ordinary quotes without a code remain available. Existing successful submission-key replays return before consuming another attempt. Broad preview/quote throttles are scoped to the authenticated user.

Validation: four related API suites passed (117 tests), including HTTP proof that 12 invalid saving quotes block the next electricity code preview while a no-code saving quote still works. API typecheck, targeted lint and formatting passed. CI for this batch is pending after the direct `main` push.
