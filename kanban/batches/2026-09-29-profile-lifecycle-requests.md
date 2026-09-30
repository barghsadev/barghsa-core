# Profile lifecycle requests

Task context: `02-auth-users-admin.md#T-11.01.01`.

The settings page now separates a profile data export request from a closure request. Only the owner of the active profile can view the closure preview or submit either request. The preview names legal holds, unpaid invoices, open refunds, wallet balance, open contracts and the required staff security review, with a responsible party and next step. These are live evaluations; they do not silently delete or alter financial and audit records.

Submitting either request creates a typed privacy support ticket and audit event in one transaction. The key is unique per customer and retries return the same ticket. Changing the active profile cannot reuse a key from another profile. Privacy tickets enter the existing staff assignment and notification workflow, using the `privacy` assignment context where configured. The settings page links recent requests to their support threads. It is bilingual and works in RTL and LTR.

This batch requests and evaluates only. The portable export job (`T-11.01.02`) and reviewed closure execution (`T-11.01.03`) remain separate work. Security review is a staff gate until that execution workflow exists.

Validation: lifecycle HTTP integration tests with real PostgreSQL for blockers, ownership, active-profile switching, idempotency, audit and ticket creation; bilingual web component tests; build, typecheck, lint, formatting, migration snapshot and backlog checks.
