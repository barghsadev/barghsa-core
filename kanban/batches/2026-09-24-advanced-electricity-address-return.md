# Advanced electricity address return — September 24, 2026

Canonical scope: advanced-order review continuity in `03-core-business.md#T-03.06.04.05` and resumable progress in `T-03.90.17`.

When a customer needs to add an address from the advanced-order review step, the wizard now saves that step before leaving. If the save is not confirmed, it stays in place and shows the existing draft-save error. Address settings accepts only the known advanced-order return route and offers a bilingual link back. Returning reloads the saved draft and current address list, so the customer can select an address and submit without rebuilding the bundle. Ordinary visits to address settings remain unchanged.

Validation: seven focused advanced-wizard tests, the updated bilingual advanced-order browser journey that creates a new address and returns to submit in all five browser projects (10 cases), web and dictionary typechecks, targeted lint and formatting, dictionary tests, production web build, and backlog validation.
