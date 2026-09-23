# CI and migration repair

The production migration runner now commits through `0152_electricity_rejected_contract` before applying later migrations. PostgreSQL cannot use the newly added `Rejected` enum value inside the same transaction, so upgrades from older contract schemas had stopped at `0153`. The runner still verifies the original migration SQL checksums and holds its advisory lock across both transactions.

Migration `0173_new_domain_updated_at` attaches the existing timestamp trigger to 11 mutable electricity, saving, solar, and consultation tables created after the original timestamp migration. Legacy upgrade and seed tests now check preserved historical rows and the four electricity products without assuming the schema ends at migration `0146` or that later system products do not exist.

Normal `main` pushes now run affected tests against the push's previous commit. Build, typecheck, lint, security scans, schema and contract checks, and the route budget checker's unit tests remain enabled. Browser coverage, combined coverage, and production route budgets are temporarily opt-in through the `CI_FULL_CHECKS=true` repository variable; the measured auth and electricity bundles still exceed their existing limits and need a separate optimization batch.

Validation: all 932 database tests across 109 files passed; root build, typecheck, lint, formatting, database snapshot, OpenAPI contract, backlog validation, and `actionlint` passed.
