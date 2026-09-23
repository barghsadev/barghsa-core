# Advanced electricity draft recovery — September 24, 2026

Canonical scope: the safe resume and error-recovery requirement in `03-core-business.md#T-03.90.17` for the advanced wizard in `T-03.06.04.01`–`.05`.

The advanced electricity wizard no longer opens an empty form when its saved draft or address context fails to load. It shows a retry action and restores the saved step and inputs after a successful retry, avoiding accidental replacement of an existing server draft. Advancing a step now requires the draft-save response to confirm that exact step; an unexpected response leaves the customer on the current step to retry. The same retry action recovers an initial profile, catalogue, or settings load failure.

The local Playwright server disables the development-only TanStack Router control so it cannot cover wizard actions on small RTL screens. Production behavior is unchanged.

Validation: six focused advanced-wizard unit tests, the bilingual advanced-order journey in all five browser projects (10 cases), web typecheck, targeted lint and formatting, production web build, and canonical backlog validation.
