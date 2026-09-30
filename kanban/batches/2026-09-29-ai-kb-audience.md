# AI knowledge-base audiences and slot preview

Task context: `05-notifications-documents-ai.md#T-05.22.04` and `07-ui-ux-design.md#T-07.20.01.08` (foundation, not complete production chat).

Knowledge bases now have an explicit audience: admin, all staff, all signed-in customers, or public. The migration leaves every existing base admin-only. Staff can choose an audience in the bilingual editor; the step-up-protected change is audited with its previous and new values, and the confirmation warns about sharing indexed passages. The database rejects unknown audiences.

Admin test chat can preview an agent as one of the five slots. It filters linked bases both when selecting eligible sources and when querying passages. Staff previews see staff and public bases, customer and Telegram previews see customer and public bases, and website previews see public bases. An agent configured to require all linked bases fails if one is unavailable to the selected slot. Scoped previews do not replay earlier admin conversation turns, and idempotent response replay rechecks the current publication scope. The existing unrestricted admin preview remains available for curators.

This is a working publication and preview boundary. It does not expose a production customer chat endpoint or profile records, and it does not yet implement profile-bound tools, Telegram account binding, or staff role-scoped data retrieval. Those controls must be enforced before production chat is released. Audience labels deliberately say **all** staff/customers: profile-specific material must not be published into these shared bases.

The same batch repairs browser fixtures after the configurable brand-contact change and aligns the generated OpenAPI title with the new source. The fixture now sends the required brand fields, so numeral preference checks exercise the intended setting again. The metrics outage test now waits briefly for a fresh collection after PostgreSQL reopens, since terminated pool sockets can survive the first scrape.

Validation: 77 migrated HTTP tests for knowledge bases, agent preview and metrics recovery; 70 browser tests across Chromium, Firefox, WebKit, mobile Chrome and mobile Safari; root typecheck, lint, format, database snapshot check, suppressed-error check and build; OpenAPI contract and canonical backlog checks. The optional full-CI route budget check still reports six oversized routes inherited from the current main branch; the two admin routes changed here pass their budgets.
