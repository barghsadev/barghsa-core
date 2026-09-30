# Operating-context integration fixtures

Canonical scope: CI follow-up to [staff/customer operating contexts](2026-09-29-staff-customer-context.md).

Older HTTP tests created staff sessions with the database's customer default. The suites now explicitly create staff sessions for staff endpoints and separate customer sessions when the same dual-role account uses customer endpoints. Cross-context requests expect the current 403 boundary. The finance notification test names staff context when reading the staff inbox.

Validation: the twelve integration suites identified in the failed main CI run, plus API typecheck and changed-file lint and formatting.
