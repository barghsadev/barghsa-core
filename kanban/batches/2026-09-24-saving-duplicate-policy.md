# Saving-order duplicate policy batch

Canonical scope: `03-core-business.md#T-03.09.02.05`.

Staff with catalogue edit permission can change duplicate handling per saving plan after step-up verification. Existing plans default to blocking a second active order for the same bill identifier and plan. Every change records the before and after values in the audit log; repeating the same setting is a no-op.

The saving-order submission transaction locks the plan product row before reading its policy and checking active orders. This keeps concurrent submissions and staff policy changes ordered. The database's unconditional unique index is replaced by a lookup index. When staff allow duplicates, the customer wizard shows the existing-order warning and requires explicit acknowledgement; the API enforces that acknowledgement before creating another order. The duplicate check reveals an order ID only for the same profile. If the check fails, the wizard offers a retry and does not advance with an unknown result.

Validation: saving-order and saving-catalogue HTTP integration tests, relevant customer UI tests, API/web/DB type checks, API and web builds, changed-file lint and formatting, OpenAPI contract, database migration snapshot, and backlog validation. The HTTP test exercises staff authorization, invalid policy input, both policy states, acknowledgement, two active orders when allowed, renewed blocking, and audit entries.
