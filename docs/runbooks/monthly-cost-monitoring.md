# Monthly cost monitoring

Use provider billing exports or reconciled invoices to allocate costs to each environment. The collector reads a protected operator-prepared snapshot. Keep invoices and exchange-rate evidence in the restricted billing store. Use the same reporting currency for all allocations and approved budgets in a snapshot.

`monthly-costs.json` contains `month` in `YYYY-MM` form, `currency` as a three-letter reporting currency, and `asOf` as the exclusive UTC coverage cutoff in `YYYY-MM-DDTHH:mm:ss.sssZ` form. The cutoff cannot be after the next UTC month boundary or after the current time. Snapshots older than 35 days stop exporting metrics. A cutoff exactly at the next month boundary represents a closed month.

`costs` is an array of `{category, provider, amountMicros}` allocations. Add `model` to each `ai` allocation. Use stable billing source and model identifiers. Use the eight categories `compute`, `postgres`, `object_storage`, `storage_egress`, `redis`, `notifications`, `observability` and `ai`. Each category needs at least one reconciled line. Record zero only when the source confirms zero spend. Record one net nonnegative amount per category, provider and model, with no duplicate allocations. `budgets` is an object keyed by the same categories. Each value is the approved full-month budget. Amounts are integer millionths of the reporting currency.

Install the file in the directory referenced by `BARGHSA_MONTHLY_COST_DIR`. Publish updates by atomic rename within that directory. Keep it outside the Git checkout with read access limited to the operations container and the billing operator. Generate a separate 32-byte random hex scrape credential in the file referenced by `BARGHSA_COST_SCRAPE_TOKEN_FILE`. Make it readable only by the operations and Prometheus service accounts. Supply the reporting database DSN as `OPS_MONTHLY_COST_DATABASE_URL` in the protected operations environment file.

Provision a dedicated reporting login with `CONNECT` to the environment database and `USAGE` on `public`. Limit it to the column reads below and omit write and admin grants.

| Table                         | Columns                                       |
| ----------------------------- | --------------------------------------------- |
| `profiles`                    | `user_id`, `archived`, `status`, `created_at` |
| `users`                       | `user_id`, `disabled_at`                      |
| `orders`                      | `id`, `order_type`                            |
| `electricity_orders`          | `id`, `submitted_at`                          |
| `saving_orders`               | `submitted_at`                                |
| `solar_construction_requests` | `submitted_at`                                |
| `consultation_requests`       | `submitted_at`                                |

Apply `staging-costs.yml` with `staging-compose.yml` and `staging-dashboards.yml` from the same immutable release. The authenticated scrape is private and runs every five minutes. Keep the label values in `staging-cost-scrape.yml` matched to the operations receiver scope. Confirm the metrics endpoint stays unavailable through public ingress.

The Monthly costs dashboard shows actual and budget by category, provider/model allocation, unit costs, and cutoff age. The profile denominator is the current count of active or verified, non-archived profiles on enabled accounts that were created before the cutoff. It reflects the profile base at scrape time. The order denominator counts submitted electricity, saving, solar and consultation records from the UTC month start up to the cutoff. A zero denominator leaves the corresponding unit cost unavailable.

For open months, a category alert fires after spend stays more than 20% over the full-month budget for ten minutes. Closed months also alert on underspend of more than 20%. A positive charge with an approved zero budget qualifies. Verify a controlled firing and resolved P3 receipt in the admin inbox, using a separate fixture environment for test amounts. Inspect the dashboard, verify scope and reporting currency against the source invoices, and correct duplicate or misplaced charges at the source before replacing the snapshot. A missing or invalid snapshot produces an unsuccessful scrape. Investigate its cutoff and the private configuration before treating the missing series as spend.
