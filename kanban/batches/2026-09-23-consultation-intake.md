# Consultation request intake batch

Canonical scope: `03-core-business.md#T-03.01.05.01`–`03`, `03-core-business.md#T-03.03.01.01`, `03`–`04`, and `03-core-business.md#T-03.03.02.01`–`04`. Status history begins with the submission event; later status notifications belong to the staff lifecycle batch.

The migration seeds the two unpriced consultation products and creates profile-scoped consultation requests with append-only status history. Customer APIs list eligible products, submit idempotent requests, and return request lists/details. Certificate consultation is restricted to legal-entity profiles in both catalogue visibility and submission authorization. Submission verifies the active profile, enforces five requests per profile per minute, snapshots the chosen product, and creates no invoice. The customer interface now shows the catalogue, selected profile confirmation, request list, status, next step, and detail history in Persian and English.

Validation: HTTP integration covered seeded catalogue visibility, individual rejection, legal submission, idempotency, profile isolation, request history, and absence of an invoice. Root build, typecheck, lint, format, migration snapshot, backlog, and OpenAPI contract checks were run.
