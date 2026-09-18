-- Optional additional assertions for verify-restore.sh.
-- Each SELECT must return one numeric failure count. All rows must equal zero.
-- SQL errors, nonzero results and empty output fail the exercise.
-- The verifier separately compares counts AND SHA256 row fingerprints for users,
-- orders and invoices against the independently captured source baseline.
SELECT count(*) FROM pg_index WHERE NOT indisvalid;
-- Add application-specific failure-count queries below; do not return raw rows.
