# Solar final-review handoff — September 24, 2026

Canonical scope: the previously unused `final_review` state in `03-core-business.md#T-03.11.04.01` and the final-decision portion of `T-03.13.01.01`–`.03`.

After confirming receipt of original postal documents, staff explicitly start final review. That action locks and advances the request from `postal_documents_received` to `final_review`, records the actor and transition in audit history, and notifies the customer. The request remains in the staff action queue. Approval, reasoned rejection, and reasoned closure without a contract are then available from final review; staff can still close an approved request without a contract. The staff screen no longer offers a final decision before review starts. Repeating the start action conflicts, and final approval cannot skip the handoff.

The customer already has a localized `final_review` status and staff-owned next action; the existing request detail shows the new state without an additional page. The browser flow covers staff review start through rejection with controlled API responses. Migrated HTTP tests cover the committed transition, queue visibility, decision guards, audit history, and the subsequent approval/rejection routes.

Validation: focused migrated solar HTTP suite, five-browser staff flow, API/web/i18n typechecks and production builds, generated OpenAPI drift check, targeted lint and formatting, dictionary tests, and backlog validation.
