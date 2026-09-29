# Admin failure summary

Task context: `07-ui-ux-design.md#T-07.19.02.09`.

The existing admin dashboard work-count request now includes unresolved background-job failures and open notification dead letters for staff with `admin:jobs:view`. Staff with only that permission can use the summary; other roles receive `null` for those counts. The failure widget links each visible count to its existing triage page and shows failed refund obligations only to finance staff. Counts refresh with the dashboard's existing 30-second poll, without a second request.

This counts the existing `background_jobs` triage queue. The new generic `async_jobs` queue has no admin triage page yet and is not included in that link.

Validation: PostgreSQL HTTP integration test for counts, permissions and resolved states; bilingual web component tests; root build, typecheck and lint.
