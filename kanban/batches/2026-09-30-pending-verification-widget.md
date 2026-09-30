# Staff dashboard pending verification

Canonical work: `07-ui-ux-design.md#T-07.19.02.03` (`PendingVerificationWidget`).

The existing staff dashboard count now lists up to five most recently submitted profiles awaiting verification. Each row displays a customer or legal name, profile type, and a direct link to that CRM profile; missing names use a localized profile-type and ID fallback. The existing "Show all" link opens the filtered CRM queue. The widget keeps its permission and disabled-mode behavior, and rejects malformed profile entries rather than rendering them.

The existing CRM dashboard browser test now supplies a current staff session and checks the five links in Persian and English, light and dark themes, including accessibility. The CRM API already returned the correct latest-five snapshot, so no new endpoint or polling request was needed.

Validation: CRM dashboard PostgreSQL HTTP suite (6 tests), all 1,150 web unit tests, 53 i18n tests, four Chromium CRM dashboard variants, root build/typecheck/lint/format, route budgets, and generated backlog check.
