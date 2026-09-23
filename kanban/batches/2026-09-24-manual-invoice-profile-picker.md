# Manual invoice profile selection — September 24, 2026

Canonical scope: the staff customer-selection part of `04-invoices-wallet-contracts.md#T-04.1.02.02`.

Finance staff can now search legal entities by registered name and see a useful display name for both legal and individual profiles. Search results page beyond the former 50-profile limit using a stable creation-time and ID cursor. The manual-invoice picker loads more matches without losing the selected customer; a new search resets the result set and selection. Archived profiles remain excluded, and the API validates cursor identity within the same search.

Validation: manual-invoice HTTP integration, focused picker UI test, dictionary tests, API/web typechecks and builds, OpenAPI contract comparison, targeted lint/format, and backlog check. CI status follows the direct `main` push.
