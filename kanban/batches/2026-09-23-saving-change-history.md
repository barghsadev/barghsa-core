# Saving order change history

Canonical scope: customer order detail `03-core-business.md#T-03.09.04.04` and the reviewable change history for `03-core-business.md#T-03.09.04.05`.

Customer and staff order details now show each saved pre-review revision in chronological order. Each entry uses immutable snapshots to show the equipment and installation address before and after the change, plus both quoted totals. The API exposes only those display fields and the change time; idempotency keys and request hashes remain private. Persian and English labels and screen-reader before/after cues are included.

Validation: the saving-order HTTP integration suite verifies both authorized detail responses after two revisions and checks that internal request hashes are absent. The production build, typecheck, targeted lint and formatting, OpenAPI contract, database snapshot, and backlog validation pass.

Changes after staff approval and postpayment staff amendments remain open under `03-core-business.md#T-03.09.04.05`.
