# Admin refund work dashboard

Canonical scope: `03-core-business.md#T-03.90.10`.

The admin dashboard now shows the live count of unresolved contract and electricity refund obligations and an alert when any of those refunds has failed or exhausted its retry job. Both link to the existing finance work queue in the contract workspace. Staff without financial edit permission receive null counts and see no finance widget; finance-only staff can see their own work without unrelated order or document counts.

Validation: migrated dashboard HTTP tests cover the pending and failed counts and permission boundaries. Component tests cover the finance card, alert, destination, and hidden state. API/web typechecks, lint, formatting, OpenAPI, backlog validation, and a web build run before push.
