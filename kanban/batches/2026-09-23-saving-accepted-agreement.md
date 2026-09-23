# Accepted saving agreement history — September 23, 2026

Canonical tasks: `03-core-business.md#T-03.01.04.07` and `03-core-business.md#T-03.01.04.08`.

New saving orders store the exact agreement title and body accepted at submission. The customer detail labels this as the accepted agreement, keeps that text unchanged after a newer plan agreement is published, and shows a visible bilingual notice when the active version differs. The detail API derives that notice from the order's saved version and the plan's current active version. Earlier body-only snapshots remain intact in storage; the detail response reconstructs their title from the immutable accepted agreement version so customers can still read the complete accepted terms.

Validation: six saving-order HTTP integration cases, three focused bilingual component cases, 53 dictionary tests, API/web typechecks, web production build, targeted lint and formatting, OpenAPI contract, and backlog validation passed locally. CI passed on `main` in [run 35909156013](https://github.com/barghsadev/barghsa-core/actions/runs/35909156013).
