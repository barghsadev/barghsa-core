# Solar staff queue triage — September 24, 2026

Canonical scope: staff queue usability in `03-core-business.md#T-03.12.02.01` and postal-stage distinction in `T-03.12.03.06`.

The postal queue opens on requests that need staff action: shipped originals awaiting receipt decisions, received originals awaiting final approval, and approved requests awaiting contract creation. Staff can switch to customer-waiting requests or all open postal work. Each lane has its own stable cursor, and changing lanes clears the prior rows and selection. Postal and document request rows now show the requester profile, creation date, localized status and full request ID, so staff can distinguish otherwise identical entries.

Validation: solar document and postal HTTP integration flows, dashboard queue tests, dictionary tests, API/web typechecks and builds, OpenAPI contract comparison, targeted lint/format, and backlog check. CI status follows the direct `main` push.
