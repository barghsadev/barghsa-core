# Quarterly access review

The service owner and security reviewer run this review each quarter and
after a material change to identity, financial or provider access. Use the
database that serves the target application. Record the environment, release
SHA, review date and reviewers with the restricted evidence.

## Capture the database inventory

Use an authorized PostgreSQL review connection from protected connection
configuration. Set `BARGHSA_REVIEW_DIR` to the restricted evidence directory.
From the reviewed checkout, run:

```sh
(
  umask 077
  report=$(mktemp "${BARGHSA_REVIEW_DIR:?}/access-review.XXXXXXXX") || exit
  if psql -XqAt -v ON_ERROR_STOP=1 \
    -f docs/operations/preflight/quarterly-access-review.sql > "$report"; then
    printf '%s\n' "$report"
  else
    rm -f "$report"
    exit 1
  fi
)
```

The report uses one read-only snapshot. It includes current staff role
assignments, including disabled staff and staff without roles, plus login
roles and direct memberships from the PostgreSQL catalog. Credential rows
cover database-managed email, SMS, AI, storage and verification settings.
The mask is constant. Configuration creation and verified test timestamps
describe the application record. Key issuance and last use stay empty until
verified from the provider or credential manager. [PostgreSQL transactions](https://www.postgresql.org/docs/17/sql-set-transaction.html) · [PostgreSQL role catalog](https://www.postgresql.org/docs/17/view-pg-roles.html)

## Review and record decisions

1. Match every staff assignment to an active owner and approved duties. Read
   the current role definitions when checking custom grants. Check disabled
   staff, old grants and staff without an assigned role. Record each required
   revocation or role correction with an owner and verification date.
2. Match the database login roles to their owners. Review inherited authority,
   expiry, replication, administration and row-security bypass. Compare with
   the deployment and hosting inventories for API, worker, backup and other
   service identities, and record who owns each account and why it is needed.
3. Add credentials from protected runtime configuration and provider control
   planes, including any Telegram, payment, hosting and deployment credentials.
   Record masked references, scope, issuance, last verified use and evidence.
   Flag unknown dates and accounts for follow-up with the relevant owner.
4. Walk through auth, profile isolation, wallet/payment/refunds, contracts,
   document intake, admin settings, external providers and assistant access.
   Update the affected threat entries and attach current control evidence when
   a flow changed. Record reviewed boundaries and follow-up owners in the
   restricted evidence. [Threat model](../threat-model.md#risk-decisions-and-review-cadence)

Keep the raw report and signed review with the quarterly operations evidence.
Record the environment, release SHA, date, disposition references and follow-up
in the release board. Use the normal approved change paths for revocation and
rotation. Share only the counts or redacted receipts needed for release review.
