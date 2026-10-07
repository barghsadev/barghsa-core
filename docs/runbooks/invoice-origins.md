# Invoice origin foreign keys

Migration `0259_invoice_origin_foreign_keys` expands contracts and consultation requests with generated, unique text keys derived from their existing UUID IDs. Existing nullable invoice `contract_id` and `consultation_id` values and callers keep their text representation. RESTRICT foreign keys then validate every existing origin. No invoice, payment, snapshot or audit row is rewritten.

Apply with the normal production migration runner. Validation fails transactionally on unknown or noncanonical parent IDs. Inspect and reconcile those records under the approved financial retention process before retrying; never clear their origins or fabricate parent records to pass migration. Existing order foreign keys are unchanged.

For an application rollback, retain these compatible columns and constraints. If the migration itself must be reversed, drop the two named invoice foreign keys first, then their generated parent columns in one transaction. That restores the previous permissive origin storage while preserving history. Reapply the migration after diagnosing the failure. Source-bound migrated tests cover fresh install, existing-row validation, rejection, rollback and retained orphan evidence.
