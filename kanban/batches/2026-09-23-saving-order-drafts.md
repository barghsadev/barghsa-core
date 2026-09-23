# Resumable saving order drafts — September 23, 2026

Canonical task: `03-core-business.md#T-03.90.17` (saving-order wizard implementation).

The individual customer saving-order wizard now loads a profile-scoped server draft and persists each completed step before advancing. The reusable `useFormDraft(key, schema)` hook validates loaded and saved data, supports retry after a load failure, and leaves entered values in place after a save failure. The draft expires after seven days and is deleted atomically on successful order submission, including idempotent replay. Resuming at review returns to agreement acceptance so the customer explicitly accepts again. Draft reads and writes require a current session and permission to manage the individual profile; writes are audited.

Validation: saving-order HTTP integration suite (5 tests), all web tests (970) and focused save-failure cases (2), dictionary tests (53), API/web/database typechecks, production web build, database snapshot and OpenAPI checks, targeted lint/format, and backlog validation passed. CI is pending after the direct `main` push.
