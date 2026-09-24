# Development continuation status

## Current manual batch — September 24, 2026

[Contract initial-invoice next action](batches/2026-09-24-contract-invoice-next-action.md) sends customers from an accepted or signed contract to an unpaid initial invoice and distinguishes payments under staff review.

[Automatic electricity contract PDF](batches/2026-09-24-automatic-electricity-contract-pdf.md) creates the reviewable original PDF in the order transaction whenever an admin template is selected, with audited document states and retryable failure handling.

[Electricity contract PDF generation](batches/2026-09-24-electricity-contract-pdf.md) lets staff create a reviewable PDF from saved terms for the exact original or accepted amendment version, with Persian rendering and signature handoff.

[Signed contract amendments](batches/2026-09-24-signed-contract-amendments.md) preserve the effective version through customer acceptance and required signing, with exact-version PDF and signed-copy evidence.

[Pending amendment list status](batches/2026-09-24-contract-amendment-list-status.md) makes draft, acceptance and signature work visible beside the effective contract in staff and customer lists.

[Readable customer electricity order snapshot](batches/2026-09-24-electricity-order-snapshot.md) shows the profile name, order method, submission time and saved postal code on customer detail.

[Electricity order financial closure](batches/2026-09-24-electricity-refund-clarity.md) distinguishes remaining refund from remaining payment on terminal orders and explains when no refund is due.

[Actionable next steps in customer electricity orders](batches/2026-09-24-electricity-order-next-actions.md) links order-list callouts to the invoice, contract or correction detail needed next.

[Wallet balance breakdown on the dashboard](batches/2026-09-24-wallet-balance-breakdown.md) shows exact available, posted and reserved funds and warns when unpaid invoices exceed the available balance.

[Wallet history presentation and invoice handoff](batches/2026-09-24-wallet-history-handoffs.md) finishes account-timezone transaction display and links wallet payments back to their invoices.

[Staff invoice search by customer and order](batches/2026-09-24-staff-invoice-search.md) lets finance find invoices from a known profile or order, with validated combined filters and stable pagination.

[Customer invoice payment summary](batches/2026-09-24-invoice-payment-summary.md) shows exact payment progress and the existing wallet action together on the viewed invoice.

[Customer invoice reference and payment progress](batches/2026-09-24-invoice-reference-payment-progress.md) makes each customer invoice identifiable and shows the confirmed paid amount in the list.

[Electricity service period on invoices](batches/2026-09-24-invoice-service-period.md) shows the immutable service dates on customer and finance invoice list/detail views, including revised invoices, in the account timezone.

[Staff electricity and contract invoice handoffs](batches/2026-09-24-staff-invoice-handoffs.md) deep-links the staff order, adjustment and contract views to exact finance invoice details while retaining invoice permission checks.

[Staff invoice ledger and detail](batches/2026-09-24-staff-invoice-ledger.md) gives finance staff a permission-checked invoice search, paginated list, line/VAT and payment detail, and direct receipt and due-date handoffs.

[Invoice receipt bank name](batches/2026-09-24-invoice-receipt-bank-name.md) stores and shows optional bank metadata on customer and finance receipt views while preserving legacy records.

[Invoice bank-receipt finance history](batches/2026-09-24-invoice-receipt-finance-history.md) adds a paginated reviewed-receipt list with outcome and invoice filters, and lets staff reopen terminal details.

[Invoice bank-receipt finance queue](batches/2026-09-24-invoice-receipt-finance-queue.md) gives finance staff a reviewed confirm/reject flow with allocation preview and second-approval handoff.

[Customer bank receipt detail and attachment](batches/2026-09-24-customer-receipt-detail.md) adds a scoped receipt download and submission/confirmation times to invoice detail.

[Saving contract to order return](batches/2026-09-24-saving-contract-order-return.md) links the published customer saving contract back to its saving order using the correct saving-order ID.

[Contract service and initial invoice overview](batches/2026-09-24-contract-overview.md) shows the version's service dates and the linked initial invoice amount/status in customer and staff contract lists.

[Invoice to published contract return](batches/2026-09-24-invoice-contract-return.md) connects an authorized invoice directly to its published contract in the customer view.

[Electricity commercial and financial status pair](batches/2026-09-24-electricity-dual-status.md) shows both order and payment progress together in customer and staff detail views.

[Electricity contract to order return](batches/2026-09-24-electricity-contract-order-return.md) exposes the authorized source order and links published customer contract detail back to that order.

[Customer contract milestones and invoice handoff](batches/2026-09-24-contract-milestones-invoice-link.md) shows publication and acceptance history and links the activation prerequisite to its initial invoice.

[Customer invoice due date and VAT detail](batches/2026-09-24-invoice-transparency.md) exposes existing API fields in the list and each invoice line. Bilingual tests verify the date, amounts, column labels and accessibility.

[Consultation history and offer deadlines in the account timezone](batches/2026-09-24-consultation-account-time.md) aligns customer and staff timelines and makes staff offer expiry editing use the saved timezone. Focused tests cover the UTC+14 boundary, unchanged instant preservation and a skipped daylight-saving time.

[Solar history in the account timezone](batches/2026-09-24-solar-history-account-time.md) aligns customer requests and staff document/postal queues with the saved timezone. The invoice-to-contract browser journey verifies a UTC+14 date boundary.

[Saving history in the account timezone](batches/2026-09-24-saving-history-account-time.md) aligns customer and staff saving timelines, fulfillment, amendments and shared order comments with the saved timezone. The customer browser journey verifies a date-boundary case in UTC+14.

[Electricity workflow timestamps](batches/2026-09-24-electricity-workflow-timestamps.md) applies the saved account timezone to staff order review and customer order changes, including revision comparisons, conversations, timeline, quantity increases and price adjustments.

[Electricity period dates in the account timezone](batches/2026-09-24-electricity-period-dates.md) keeps order history and detail dates tied to the saved timezone and displays the final included period day. The simple-order English selector now names the actual Gregorian range.

[Localized electricity date and time selection](batches/2026-09-24-localized-electricity-date-time.md) replaces the advanced-order and revision control with a shared Jalali/Gregorian picker and a locale-appropriate clock. It preserves the stored instant and existing saved drafts across language changes; bilingual journey and component browser checks pass.

[Privacy-safe product analytics](batches/2026-09-24-private-analytics.md) adds account consent, anonymous fixed-dimension events, a shared redaction gate, a self-hosted endpoint and an optional Google adapter. The prior CI failure was two historical migration tests comparing entire `users` rows; those assertions now check preservation of the original columns across additive migrations. Google script loading remains unconfigured and off by default.

[Per-user display theme](batches/2026-09-24-user-theme-preference.md) completes `T-06.03.05`: signed-in users can save Default, Light or Dark, with an audited account setting that survives reload and respects the active admin default. PostgreSQL and bilingual browser checks pass.

[Admin theme tokens](batches/2026-09-24-admin-theme-tokens.md) add validated background, font, corner-radius and spacing overrides to the branding draft, preview, public response and applied CSS.

[Electricity order revisions](batches/2026-09-24-electricity-order-revisions.md) let customers reprice and resubmit simple or advanced orders after staff request changes. The transaction preserves previous lines and contract versions, replaces the unpaid invoice, and returns the order to staff review.

[Staff review of corrected electricity orders](batches/2026-09-24-electricity-staff-revision-review.md) compares the latest correction with the previous version, including the staff reason, customer response, terms, delivery address, product quantities, and invoice. Focused PostgreSQL and the full web suite pass locally. The latest direct-`main` CI run is tracked on GitHub.

[Advanced electricity order review](batches/2026-09-24-advanced-electricity-review.md) completes the final review snapshot with profile, gift code, delivery details and localized cancellation/payment terms before submission.

[Electricity order conversations](batches/2026-09-24-electricity-order-conversations.md) adds customer/staff comments, private staff notes and a post-review conversation queue. It also fixes microsecond cursor pagination for electricity and saving comments.

[Dashboard open-ticket list](batches/2026-09-24-dashboard-open-tickets.md) completes the dashboard status-card navigation. It counts the signed-in user's non-terminal tickets on the active profile and opens a matching pre-paginated ticket list with a return to all tickets.

[Dashboard contract and invoice filters](batches/2026-09-24-dashboard-contract-invoice-filters.md) makes the active-contract and unpaid-invoice cards open matching profile-scoped lists.

[Dashboard pending-order lists](batches/2026-09-24-dashboard-filtered-orders.md) completes filtered navigation from the dashboard count to electricity and saving orders. Both APIs filter before pagination, and both customer pages support the pending view in Persian and English.

[Customer dashboard live status](batches/2026-09-24-dashboard-live-status.md) replaces stale legacy counts with current contract, electricity and saving workflow states and gives customers direct routes to both order lists.

[CI main-run concurrency](batches/2026-09-24-ci-main-concurrency.md) groups checks by workflow and branch so a new direct `main` push cancels an older redundant run while preserving every check on the newest cumulative commit.

[Advanced electricity payment and contract journey](batches/2026-09-24-electricity-advanced-browser-journey.md) extends the existing bilingual advanced-order browser path from reviewed submission through wallet payment and the selected contract detail.

[Electricity estimate retry](batches/2026-09-24-electricity-estimate-retry.md) gives customers a direct retry after bill-data failure without clearing their quantity. It also labels the estimate's source, coverage and timestamp in the selected language.

[Electricity bill-data provider recovery](batches/2026-09-24-electricity-bill-provider-recovery.md) adds fail-fast recovery to the optional consumption estimate while keeping manual quantity entry available. This covers the electricity adapter portion of the wider provider-resilience task.

[Solar customer history](batches/2026-09-24-solar-customer-history.md) adds an authorized, customer-safe event timeline to solar request detail. The API returns only whitelisted lifecycle events and timestamps; the page labels them in both languages. A request-scoped audit index supports the read.

[Solar invoice return](batches/2026-09-24-solar-invoice-return.md) resolves the solar request from an authorized invoice's original contract and offers a bilingual return link on the invoice page, including corrected invoice views.

[Solar invoice next action](batches/2026-09-24-solar-invoice-next-action.md) connects the issued solar invoice to the customer's next action on request list and detail. Unpaid invoices link to payment, payment review belongs to staff, and a paid published contract returns to customer action. Migrated HTTP and five-browser coverage verify the handoff.

[Solar site-address return](batches/2026-09-24-solar-address-return.md) connects non-household solar intake to address creation and back. It preserves the saved draft and selects the new address; the browser journey covers creation and submission in five projects.

[Advanced electricity address return](batches/2026-09-24-advanced-electricity-address-return.md) saves the review step before a customer opens address settings, then returns them to the restored order with an updated address list. The bilingual browser journey covers this round trip in all five projects.

[Advanced electricity draft recovery](batches/2026-09-24-advanced-electricity-draft-recovery.md) keeps the advanced order wizard closed when a saved draft cannot load, offers a retry, and requires server confirmation before progressing to the next step. The bilingual browser journey passes all five projects.

[Solar final-review handoff](batches/2026-09-24-solar-final-review-handoff.md) makes the canonical `final_review` state a real staff transition after postal receipt. Final decisions now require that handoff; the customer sees staff-owned review status and the postal work queue keeps the request visible until decision.

[Solar final rejection](batches/2026-09-24-solar-final-rejection.md) adds the previously missing terminal `rejected` path after confirmed postal receipt. Staff must give a reason, customers see that reason and support route, and notification/audit evidence is recorded. Backend and staff browser coverage are included.

[Saving upgrade delivery guard](batches/2026-09-24-saving-upgrade-delivery-guard.md) closes another staff fulfillment dead end: product delivery is visibly blocked while an equipment-upgrade charge is pending, even after the original invoice is paid. A focused browser journey also checks the active-contract prerequisite for process completion.

[Saving fulfillment prerequisites](batches/2026-09-24-saving-fulfillment-prerequisites.md) makes the existing paid-invoice and active-contract guards visible in staff stage controls. Blocked completion actions explain the unmet prerequisite in both languages; the saving browser journey covers the unpaid delivery state.

[Saving staff handoff browser journey](batches/2026-09-24-saving-staff-browser-journey.md) extends `03-core-business.md#T-03.90.14` from saving-order submission through staff approval, the automatic request-confirmation handoff, and the customer's updated progress view. It asserts the staff approval payload; browser API responses are controlled, while backend transitions are covered separately.

[Simple electricity browser journey](batches/2026-09-24-electricity-simple-browser-journey.md) covers the simple-order portion of `03-core-business.md#T-03.90.14`: catalogue, period and quantity, reviewed thermal/green quote, staff review handoff, linked wallet payment, and contract tracking. The focused journey passes all five browser projects. The browser API is controlled; backend transitions remain covered in integration suites.

[Persistent language and direction](batches/2026-09-24-language-preference.md) closes the saved-language reload gap in `07-ui-ux-design.md#T-07.03.02.01`–`.02`. English and Persian selection survives later visits, and initial direction follows a saved or browser preference before React renders. Focused unit, bilingual journey, five-browser, type, lint, format, and build checks pass locally.

[Solar customer browser journey](batches/2026-09-24-solar-browser-journey.md) covers the solar portion of `03-core-business.md#T-03.90.14`: draft resume, submission, file upload, document review handoff, postal guidance, and shipment entry. The focused journey passes all five browser projects. Its API is mocked in the browser; backend transition checks remain in the API suites.

[Resumable solar intake](batches/2026-09-24-solar-intake-drafts.md) extends the shared form-draft requirement to the solar request journey. Customer site details survive a return from address settings or an interrupted session, while agreement acceptance remains explicit. Local focused tests and schema/contract checks pass; CI starts on the direct `main` push.

[Saving-order duplicate policy](batches/2026-09-24-saving-duplicate-policy.md) implements `03-core-business.md#T-03.09.02.05`: staff can block or allow duplicate active orders per plan, with an audit trail, concurrency-safe submission, and explicit customer acknowledgement when allowed. Local integration, UI, build, schema snapshot, contract, type, lint, format, and backlog checks pass. This supersedes the fixed duplicate-rule limitation in the original saving-order intake note. The batch reached `main` at `473a0fe3`; [CI run 35922862264](https://github.com/barghsadev/barghsa-core/actions/runs/35922862264) is tracked on GitHub.

The electricity browsing, ordering, payment, review, tracking and contract-change batches are on `main`. The power-saving catalogue, order, staff fulfillment, cancellation, customer changes, and paid hardware amendment batches are also on `main`; [paid hardware upgrades](batches/2026-09-23-saving-paid-hardware-upgrades.md) passed CI at `718f707f`. Solar intake, document review, postal handling, final decisions, and contract creation are on `main` as recorded in their batch notes. [Admin refund dashboard work counts](batches/2026-09-23-admin-refund-dashboard.md), [electricity supply-unavailable guidance](batches/2026-09-23-electricity-supply-unavailable.md), [shared profile submission protection](batches/2026-09-23-profile-submission-limit.md), [gift-code validation protection](batches/2026-09-23-gift-code-validation-limit.md), and [shared customer workflow status guidance](batches/2026-09-23-workflow-status-banner.md) all passed CI on `main`. [Resumable saving-order drafts](batches/2026-09-23-saving-order-drafts.md) reached `main` at `1140102d`; its CI failed on a missing draft-table timestamp trigger and one unformatted test. [Effective-dated electricity limit history](batches/2026-09-23-electricity-limit-versions.md) reached `main` at `a8d38aa5` and repairs both CI issues while preserving limit history and new-order snapshots; its full CI run passed. [Contract guidance](batches/2026-09-23-contract-signature-guidance.md) reached `main` at `cfe03c45`, passed CI, and added signature next-action ownership and the cross-workflow checklist. [Saving accepted-agreement history](batches/2026-09-23-saving-accepted-agreement.md) reached `main` at `a6897123` and passed CI. [Saving customer routing](batches/2026-09-23-saving-customer-routing.md) reached `main` at `026d6661`, restoring wizard, list and detail navigation; CI passed. [Solar and consultation routing](batches/2026-09-23-customer-request-routing.md) reached `main` at `7bc7eae9` and passed CI. [Consultation customer status](batches/2026-09-23-consultation-customer-status.md) reached `main` at `88b87d09`, adding staff ownership and bilingual next actions; CI passed. [Solar customer next actions](batches/2026-09-23-solar-customer-next-actions.md) reached `main` at `25638e31`, adding action ownership to the solar list and fixing the replacement-document stage; CI is running. [Electricity invoice return](batches/2026-09-23-electricity-invoice-return.md) reached `main` at `f12a16dd`, connecting paid and corrected invoices back to their order; CI passed. [Electricity journey navigation](batches/2026-09-23-electricity-journey-navigation.md) reached `main` at `c84c1352`, preserving the selected language from order list through invoice and contract routes; CI passed. [Electricity order history](batches/2026-09-23-electricity-order-history.md) reached `main` at `b860969d`, keeping earlier orders visible when customers load another page; CI passed. [Staff electricity review pagination](batches/2026-09-23-electricity-staff-review-pagination.md) reached `main` at `01c68199`, making pending orders beyond the first 50 reachable for staff; CI is running. [Saving invoice return](batches/2026-09-23-saving-invoice-return.md) reached `main` at `2faf295e`, connecting invoices back to saving orders and published contracts; CI is running. [Saving order history](batches/2026-09-23-saving-order-history.md) reached `main` at `5d7cacd9`, making orders beyond the first 100 accessible to customers; CI is running. [Saving staff queue access](batches/2026-09-23-saving-staff-queue.md) reached `main` at `17056969`, separating review and fulfillment work and paging through each queue; CI is running. CI for `01c68199` failed on OpenAPI snapshot drift from its new query parameter; tests and security checks passed. [Solar request history](batches/2026-09-23-solar-request-history.md) reached `main` at `6637fef5`, adding complete customer history access and in-app navigation and refreshing the contract snapshot for recent cursor APIs; CI is running. [Consultation continuity](batches/2026-09-23-consultation-continuity.md) reached `main` at `87c68751`, paging customer and staff consultation work, preserving invoice navigation, and fixing full-precision cursor comparisons across recent history queues. [Solar staff work queues](batches/2026-09-23-solar-staff-work-queues.md) reached `main` at `fa0638b2`, paging document review and postal work beyond the first 100 requests. [Individual document review](batches/2026-09-24-solar-individual-document-queue.md) reached `main` at `c35f3a3a`, exposing each pending file directly to staff with preview and review access. [Password-reset expiry test repair](batches/2026-09-24-password-reset-expiry-test.md) reached `main` at `962f7a83`, addressing a CI timing failure that could hide the intended rollback assertion. [Solar staff triage](batches/2026-09-24-solar-staff-triage.md) reached `main` at `cde19912`, separating actionable postal work from customer-waiting requests and adding requester context to staff queues. The current [manual invoice profile picker batch](batches/2026-09-24-manual-invoice-profile-picker.md) adds legal-name search and access beyond the first 50 matching profiles. The task queue is canonical for order and requirements, not a completion ledger; the older September 20–21 status below is historical context. The user requested manual batches pushed directly to `main`, without PRs or restarting the scheduler.

## Current checkpoint: PR #333 merged

Bank-receipt financial review merged as `04bc9ef180e2e1811054d6ebd064f15f57cc4030` after exact-head approval at `aad0d6e2d11e5d32de2d7c908459d08b0d5466a1` and all five checks in run35584995473. The cleanup fix waits for worker fixture connections before dropping its database. Main run35586979876 is pending. The full main run after PR332, run35580651560, passed all five checks.

Current work is [contract acceptance and signing financial review](batches/2026-09-21-contract-financial-review.md), on `codex/contract-financial-review`. Backend and bilingual UI are built with authoritative hash confirmation and persisted review evidence. 133 API tests, 83 UI tests, 1,010 shared tests, 53 dictionary tests and 40 production browser cases across all five projects pass. Original changed-source coverage gates, types, lint, builds, OpenAPI, bundle budgets and backlog checks pass. Instrumented browser coverage merge, independent review and CI remain. Canonical cross-command tasks are still partial.

Checked September 20, 2026 against CI-verified commit `faf9a2de2825e2bb829699aec2802d68c2d1f2a8` on `codex/audit-fixes`.

## Local development

PR #305 is merged at `0b768cf1`. PR #306 is merged at `999a1f44`, tracked in [batch status](batches/2026-09-20-wallet-history.md). PR #307 merged [refund storage and reservation limits](batches/2026-09-20-refund-storage.md) at `e326bdbe`. PR #308 merged [invoice activity and customer history](batches/2026-09-20-invoice-activity.md) at `460c6d5f`. PR #309 merged [manual wallet refunds](batches/2026-09-20-wallet-refund-workflow.md) at `d8df7986`. PR #310 merged the [migrated HTTP test baseline](batches/2026-09-20-http-fixture-template.md) at `d56de886`. PR #311 merged the [invoice-history coverage follow-up](batches/2026-09-20-invoice-history-coverage.md) at `25a85079`, with independent approval and all five active CI checks passing. PR #305 passes all five CI jobs, including full browser validation, unit coverage thresholds, security scans and combined changed/critical source coverage. [Verified run](https://github.com/barghsadev/barghsa-core/actions/runs/35498578584). The backlog validator passes for 1,355 tasks and 116 traceability entries. The audit validator passes for all 322 historical claims, 301 saved PRs and 58 historical skips.

Historical claim acceptance is 219 verified, 54 partial and 49 deferred. The other 1,033 canonical tasks are outside that historical audit population. They are not automatically proven unimplemented or ready. Reuse existing code and acceptance evidence before choosing a new build.

Wallet history and cumulative receipt settlement were merged in PR #306. Refund storage and reservation limits were merged in PR #307. Invoice aggregation and the remaining customer history displays merged in PR #308. Manual wallet refunds and second-person approval merged in PR #309; use the batch record for exact scope and evidence.

The merged wallet refund batch covers `.04`, the wallet portion of `.06`, and part of `.02`. Next are external reconciliation, remaining lifecycle behavior and retry processing: `04-invoices-wallet-contracts.md#T-04.4.01.02` and `.04` through `.07`. Reuse the merged schema and counter ownership, and implement guarded transitions, atomic wallet refunds, dual approval, external reconciliation and retry behavior. The automatic contract-return tasks remain dependent on the contract workflow. This is a manual continuation order, not a supervisor assignment.

Use the consolidated workflow: build a coherent dependency-related batch, run focused checks as needed, and perform one combined review and final validation. The 54 partial and 49 deferred historical claims retain their exact unmet requirements in [acceptance](../audit/acceptance-closure.json) and [skipped-work handoff](../audit/skipped-work-handoff.md). Do not restart completed repairs or silently waive owner decisions.

## Automatic loop

Automatic restart is not ready:

- PR #305 was verified merged at `0b768cf1` on September 20. The baseline blocker is resolved.
- A read-only remote ref check found no `kanban-state` branch. The default local durable-state cache is also absent on this machine.
- A read-only GitHub API check confirmed PR #304 is closed without merging and PR #305 is merged. A complete live loop-owned PR inventory remains necessary before automatic restart.
- `kanban/loop-state.json` is the September 1 historical snapshot. Its 308 completion claims are not current acceptance. Its apparent next tasks include already verified repairs.
- `audit/reconciled-loop-state.json` is the earlier blocked import of saved history. Its 263 merged identities and empty acceptance-verification array are import provenance, not the current audit ledger or dispatch authority.

Before enabling automation, reconcile current PR and state history against the acceptance ledger, and explicitly recover/bootstrap durable state under [STATE-PROTOCOL.md](STATE-PROTOCOL.md). Keep the configured scheduler paused throughout reconciliation. Do not directly edit completion arrays to skip partial or deferred work.

The user authorized repeated manual build/review/merge batches on September 20 and withdrew the prior token ceiling. This does not restart the scheduler or alter legacy supervisor state. Partial task criteria remain explicit in the batch record.

The [external bank refund batch](batches/2026-09-20-external-refunds.md) is based on PR #311 and locally validated: 35 refund tests, 36 refund/template checks, and 115 related wallet/approval cases pass. Refund coverage is 96.53% lines / 89.42% branches; the full security scan passes. Its pull request is the source for live review and merge status. After its verified merge, continue `.07` durable retry processing and the remaining `.02` lifecycle criteria. Failed retries and pending approval-time ledger entries are not yet implemented; automatic contract obligations remain separate.

PR [#312](https://github.com/barghsadev/barghsa-core/pull/312) is merged at `4eea6d19` after independent approval and all five active checks passed. The active [durable refund retry batch](batches/2026-09-20-refund-retries.md) is based on that merge. Durable failure scheduling and the registered retry worker are implemented. All 172 focused wallet/refund tests pass; package coverage closure, independent review and CI remain. Pending approval-time ledger entries remain a separate `.02` criterion.

PR [#313](https://github.com/barghsadev/barghsa-core/pull/313) merged durable refund retries at `b7bc57b4` after final exact-HEAD approval and all five active CI checks passed. This supersedes earlier retry-pending status above. Current work is the [approval-time refund transaction batch](batches/2026-09-20-refund-pending-ledger.md), based on that merge. Automatic contract obligations remain separate.

PR [#314](https://github.com/barghsadev/barghsa-core/pull/314) merged approval-time refund transactions at `5fa83cc4` with independent approval and five successful checks. The preceding full main run exposed chargeback clock and geography pagination browser failures; the [browser stability follow-up](batches/2026-09-20-geography-browser-stability.md) takes priority before contract drafts/versioning. Contract storage and a versioned lifecycle are missing dependencies for automatic refund obligations.

PR [#315](https://github.com/barghsadev/barghsa-core/pull/315) merged the browser stability repair at `7f4cb2c1` after exact-HEAD approval and all five checks passed. Current work is [contract drafts and immutable versions](batches/2026-09-20-contract-drafts.md). Staff draft APIs and storage are in validation; customer visibility and full lifecycle transitions remain outstanding.

PR [#316](https://github.com/barghsadev/barghsa-core/pull/316) merged contract draft storage and staff version APIs at `f27e982e` after independent approval and all five checks passed. The active [review and customer acceptance batch](batches/2026-09-20-contract-review-acceptance.md) must publish an exact version before exposing it to customers. Signature/document, activation and automatic refund dependencies remain outstanding.

PR [#317](https://github.com/barghsadev/barghsa-core/pull/317) merged contract review, published-version reads and customer acceptance at `50620a01` after exact-HEAD approval and all five checks passed. The full main run after #316 passed all 830 database assertions but failed its provider migration teardown's 10-second timeout. The [cleanup follow-up](batches/2026-09-20-provider-proof-cleanup.md) gives only that hook a 30-second budget; all 837 current database tests pass locally with coverage. PR #318 CI passed all 837 database tests but exposed a separate 150ms notification lease test expiry. The follow-up now controls only the heartbeat timer while retaining the real database, renewal and competing-worker checks; all 460 worker tests pass with coverage. After its updated review and merge, continue E-05 document lifecycle as the prerequisite for contract signatures. UI, signature/activation, amendments, cancellation and automatic refund obligations remain outstanding.

PR [#318](https://github.com/barghsadev/barghsa-core/pull/318) merged both CI test repairs at `420a69d6` with independent approval and all five checks passing. Current work is the [document lifecycle backend](batches/2026-09-20-document-lifecycle.md), based on that merge. Local validation passes 111 API, ten database and nine permission tests, builds/types, migration snapshot and OpenAPI checks. Changed-source coverage passes. Independent review found and prompted a contract replacement lineage correction; final review and CI remain. Earlier pending-review/merge language above is historical.

The full main run after #317 also passed all five checks: https://github.com/barghsadev/barghsa-core/actions/runs/35534595745. The full main run after #318 passed all five checks, including browser validation and combined coverage: https://github.com/barghsadev/barghsa-core/actions/runs/35536182258.

PR [#319](https://github.com/barghsadev/barghsa-core/pull/319) implements the document backend and remains open. Final reviewed HEAD is 770d601e29476faebc1eb0c648a160b7dc6d4243, approved in [review](https://github.com/barghsadev/barghsa-core/pull/319#issuecomment-5752910813); [CI](https://github.com/barghsadev/barghsa-core/actions/runs/35539788097) is pending. The cross-version/role replacement guard, metrics teardown race and legacy upload fixture correction are recorded in its batch file. In parallel, the [document workspace UI](batches/2026-09-21-document-workspace.md) is locally validated on codex/documents-ui: 21 frontend tests, 53 API tests, bilingual dictionary validation, four production browser checks and the changed-source gate pass. It has no PR yet and must be rebased onto the verified backend merge before review/CI. Scheduler and historical state remain unchanged.

PR [#319](https://github.com/barghsadev/barghsa-core/pull/319) merged at `d6686cb619fb2de180a8f7aa6d02d4fda6f1f434` after exact-HEAD approval and all five checks passed. The active [document workspace UI batch](batches/2026-09-21-document-workspace.md) is rebased onto that merge with the same locally validated source. Independent review and CI remain. This supersedes the pending backend status above.

Document UI PR [#320](https://github.com/barghsadev/barghsa-core/pull/320) is independently approved at `b564c1e2a2f219d711306f407862775f83b6ea40` in [review](https://github.com/barghsadev/barghsa-core/pull/320#issuecomment-5753077285). [CI](https://github.com/barghsadev/barghsa-core/actions/runs/35541233169) passes static security, secrets and integrity; tests remain live. While that runs, `codex/contract-workspace` holds the next [local contract UI batch](batches/2026-09-21-contract-workspace.md): its staff list API passes 26 HTTP tests and API type/lint checks. UI remains unbuilt. Rebase this draft onto the verified #320 merge before its PR.

PR [#320](https://github.com/barghsadev/barghsa-core/pull/320) merged at `cefe44c42df68473bb5bb3488e053987cac78823` with independent exact-HEAD approval and all five CI checks passing. The active [contract workspace batch](batches/2026-09-21-contract-workspace.md) now implements customer/staff lists, version history, exact-version acceptance/review and contextual documents. Local validation passes 62 API, 21 frontend, dictionary and four bilingual browser checks, builds/types/lint/static scan/OpenAPI/bundle. Commit coverage gate, independent review and CI remain before merge. This supersedes earlier local draft status.

PR [#321](https://github.com/barghsadev/barghsa-core/pull/321) remains open at `acfd45c81a300b2275af9704ad6ab9df1cd2e18a`, approved in [review](https://github.com/barghsadev/barghsa-core/pull/321#issuecomment-5753234841). Its [CI rerun](https://github.com/barghsadev/barghsa-core/actions/runs/35542614185) passes security, secrets and integrity; tests are still running. Full main after #319 [passed all five checks](https://github.com/barghsadev/barghsa-core/actions/runs/35540751035). The next local [signed-copy evidence batch](batches/2026-09-21-contract-signature-evidence.md) is on `codex/contract-signature-evidence`; migration/schema/guards pass 15 related database tests and snapshot comparison. API/UI remain to build. Rebase the draft onto verified #321 merge before opening its PR.

PR [#321](https://github.com/barghsadev/barghsa-core/pull/321) merged at `2aac2f49c37952fa8452f9b2e68715291672f2f5` after exact-HEAD approval and all five checks passed. The signature-evidence batch now passes 15 database tests, 44 related API tests, 15 frontend tests and eight bilingual production browser checks. Types/build/lint/snapshot/OpenAPI checks pass. Final coverage, independent review and CI remain. Full main after #320 passed tests/security/integrity but found one uncovered admin navigation branch in combined coverage; investigation remains open. Earlier pending-merge/draft statuses above are historical.

Signature PR [#322](https://github.com/barghsadev/barghsa-core/pull/322) is independently approved at `16d4ee986a1ca1d6023bf1f43f3b88c7e42523c3` in [review](https://github.com/barghsadev/barghsa-core/pull/322#issuecomment-5753480348). The historical signed-row compatibility correction passes expanded migration and API tests. CI run 35544425429 remains pending. A [route-loading follow-up](batches/2026-09-21-contract-route-loading.md) removes redundant lazy wrappers that caused the full-main #320 synthetic coverage branch; 27 local frontend cases and types/build pass, browser/combined coverage remain. Rebase this follow-up onto the verified signature merge before opening its PR.

The route follow-up is locally validated at `40d8c7f903b248643346a90d383d5a5e733f0bcc`: 27 frontend and 12 bilingual browser checks pass; collected browser plus unit coverage passes all changed/critical routes, with the generated import-line branch removed. All 44 bundle budgets and types/lint pass. Signature #322 remains approved with CI tests pending; merge it using the verified review binding before rebasing and opening this follow-up. Next feature scope is activation configuration, prerequisite resolution and customer/staff visibility (`T-04.5.01.04`, `T-04.5.03.01` through `.03`); automatic activation remains dependent on that evidence.

Signature PR [#322](https://github.com/barghsadev/barghsa-core/pull/322) merged at `c9bdd1c76fa173965bc3282e8ce8d9d4f677529a` after the exact corrected-HEAD approval and all five CI checks passed. The route-loading follow-up is rebased onto that merge and is next for review/CI. A separate local activation foundation is saved on `codex/contract-activation-prerequisites` at `521c1298`; 43 database and 29 contract HTTP tests pass. Its rule administration, resolver and UI remain unbuilt; do not count it as completed. Rebase the activation draft after the route follow-up merges.

PR [#323](https://github.com/barghsadev/barghsa-core/pull/323) merged at `fee178e7ae6637645d3d742ec414f4e0237ee7a0` after final exact-HEAD approval and all five checks passed. It removes redundant route lazy loading and covers custom contract labels in browser flows. Actual combined dictionary coverage is now 3/3 lines and 6/6 branches; all changed route lines pass. Main runs after #322 (35545314934) and #323 (35545814385) are still running.

The active [activation prerequisite batch](batches/2026-09-21-contract-activation-prerequisites.md) has typed/versioned rules, immutable version snapshots, versioned invoice/date context, audited rule administration APIs and an exact-version prerequisite resolver. 43 database and 60 related API tests pass, with API types/lint. It has no PR yet; UI, final coverage/browser/static validation and review/CI remain. No automatic Active/Completed transition or full lifecycle completion is claimed.

### Activation prerequisites interface ready for review

Current branch `codex/contract-activation-prerequisites` builds on verified PR #323 merge. Rule controls and exact-version checklist are implemented in both languages. Local validation: 43 database, 60 HTTP integration, 22 frontend, 12 production Chromium cases; types/lint/format/snapshot/backlog and process/unit coverage pass. Final browser coverage, independent review and CI remain. Automatic activation/completion, template PDF generation, editing UI, amendments and cancellation remain unfinished. Scheduler and historical supervisor completion records are unchanged.

### Automatic activation batch built locally

PR #324 head331ac8b375fd089879b1a21e43876d65c2701add has exact-HEAD approval at https://github.com/barghsadev/barghsa-core/pull/324#issuecomment-5753727815 and passes committed combined source coverage. CI35546506754 is still running; do not merge until all five gates pass. Its immutable approval binding is /tmp/barghsa-activation-review-binding.json.

Local branch `codex/contract-system-activation` is stacked on that head and implements the next activation transition batch. See its batch record for53DB/60HTTP/14worker+poller/17frontend/6browser validation and remaining review/CI. After #324 merges, rebase only this new batch onto its verified squash SHA. Full main after #322 failed only the dictionary gap already corrected in #323; #323 full run35545814385 remains pending. No supervisor history or scheduler state changed.

### PR #324 merged; system activation on current main

Verified PR #324 merged as `7c3816394f81ad909818d505f210ebbd53986213` after all five gates passed in run35546506754. Exact reviewed head331ac8b375fd089879b1a21e43876d65c2701add and durable review were read back after merge. System activation batch has been rebased onto this verified main commit. Final committed coverage, its independent review and CI remain. This supersedes the prior pending-merge note.

### PR #325 contract snapshot correction

Initial headc3f738c72c54934580d1473f035d78d9d362252b was independently approved at https://github.com/barghsadev/barghsa-core/pull/325#issuecomment-5753875481 and passed local combined coverage. CI found the newly registered contract_activation job enum missing from generated OpenAPI. Regeneration adds exactly that enum value; check:contract passes. New review/CI are required after this correction. The end-of-term completion draft is preserved in named stash `contract-term-completion draft before PR325 OpenAPI correction` on branch `codex/contract-term-completion`.

Full main run35545814385 after PR #323 now passes all five checks. PR #324 full main run35547612589 remains running.

### Term completion built and locally validated

PR #325 corrected head `8a4afc3361a7118df29ee39755ddc13ea9527817` is independently approved in [review](https://github.com/barghsadev/barghsa-core/pull/325#issuecomment-5753916838). CI run35548123603 still has tests pending. The completion draft was restored, built and validated on `codex/contract-term-completion`; no draft stash remains. Its batch record contains the passing focused checks. Commit coverage, independent review and CI remain. Service completion preserves invoice/refund state and does not implement financial closure. Rebase onto the verified #325 squash merge before opening the next PR.

### PR #325 merged; completion ready for review

Activation PR #325 merged at `fa6a383b9bd5369390d4175c9ac7d59a2ba0313c` after corrected-head approval and all five CI gates passed in run35548123603. The completion batch is rebased onto that verified merge. Its unit/process combined coverage passes; final committed browser coverage, independent review and CI remain. The next context-editing interface is saved on `codex/contract-context-editor` at `1bffe41d`, with types/lint and30 focused tests passing. Its browser/coverage/review/CI remain, and it must rebase onto the completion merge.

### PR #326 approved; draft context editor in validation

Completion PR #326 is approved at `a21cd099c48cb2bba426f8d01e76df553b5afac0` in [review](https://github.com/barghsadev/barghsa-core/pull/326#issuecomment-5754061954). Its committed combined coverage passes; CI run35549391725 is pending. Full main after #324, run35547612589, now passes all five gates. The context editor branch has been rebased onto this completion head and is running production browser checks. Its final coverage, review and CI remain. Rebase it onto the verified completion squash merge before opening the next PR.

The context-editing interface now passes30 focused tests,10 bilingual production browser flows,types/lint/build,44 bundle budgets and static analysis. Final committed coverage and independent review/CI remain. No new PR is open while #326 CI is pending.

### PR #326 merged; context editor ready for review

Completion PR #326 merged as `0de427bda68c620b73254cc8aba80a1a90a4a36d` after exact-HEAD approval and all five CI gates passed. The context editor is rebased onto that verified merge; final browser coverage is being bound to its rebased head, followed by independent review and CI. A later cancellation foundation is preserved on `codex/contract-cancellation` at `91eac8e7`. Its read-only financial preview passes40 unit/HTTP cases,API types/lint/OpenAPI checks; cancellation commands,mandatory refund processing,financial closure and UI remain unfinished. Rebase that draft after the editor merges and complete its entire workflow before its PR.

### PR #327 approved; cancellation foundation rebased

The editor PR #327 is independently approved at `5cf7b0ba7ba969388acf4ba17ab193a6cd2f1f02` in [review](https://github.com/barghsadev/barghsa-core/pull/327#issuecomment-5754208234). Actual combined source coverage passes and CI run35550678883 remains pending. The cancellation foundation is rebased onto this approved head. Its40 unit/HTTP cases,API types/lint/OpenAPI checks still cover identical source. Its batch record documents the remaining cancellation/refund/closure/UI workflow. Rebase onto the verified editor squash merge before further publication.

### PR #327 merged; cancellation storage validated

Editor PR #327 merged at `cac42489bf39a7b08443d1acb547480cf8572cee` after its exact-HEAD approval and all five CI gates passed in run35550678883. Full main after #325, run35549306810, also passes all five checks; full main runs after #326/#327 remain live. The cancellation batch adds migration0145 for immutable decision/execution/obligation storage and bound approval/non-dismissal guards. Its89 related migrated DB cases and5 approval-schema tests pass, with DB types/lint/snapshot checks; the earlier financial preview passes40 unit/HTTP cases. Command authorization and execution,commit-time completeness,automatic returns,financial closure and UI remain unfinished. Keep the entire workflow in one future PR. No scheduler or historical supervisor completion history changed.

### Cancellation commands locally validated

On `codex/contract-cancellation`, dedicated prepare/read/execute endpoints now save and revalidate immutable financial decisions, threshold approval and current authority, then atomically create cancellation evidence and refund obligations. Generic approval creation cannot produce unbound cancellation approvals. Local validation passes71 API unit/HTTP cases and19 shared approval cases,API/web types,targeted lint,OpenAPI consistency. Database commit-time completeness and payment-source race guards,automatic obligation fulfillment,financial closure and bilingual workflow remain unfinished. Keep the complete workflow in one future PR. Full main after #326,run35550597502,now passes; #327 run35551479937 remains pending. No scheduler or supervisor completion history changed.

### Cancellation obligation enforcement and wallet processing

Current cancellation branch enforces execution evidence and refund completeness at commit, including actual paid electricity balances. It automatically queues immutable wallet obligations through the existing ledger/retry worker, supports partial-funded invoices, records provenance and sends finance/customer exhaustion notices. Validation passes70 HTTP cases,41 lifecycle/upgrade DB cases and55 refund/storage DB cases,with9 overlapping cancellation cases,plus DB/API types,targeted lint and snapshot checks. Payment-race guards,external-bank obligation handling,financial closure and bilingual UI remain before final coverage/review/CI/PR. Full main #327 run35551479937 was still live at the latest check.

### Cancellation payment races and external returns validated

Cancellation guards now include pending receipt/wallet sources, forbid new payments and invoice reassignment/charges/deletion after cancellation, and serialize racing sources against the invoice/contract. External obligations support paid and partial-funded balances with separate current-finance transfer/reconciliation. Validation passes44 cancellation/snapshot/wallet HTTP cases and43 cancellation/external/bank-confirmation cases,with overlapping cancellation cases;86 related DB cases plus the new direct-write reconciliation case verified in10 cancellation cases;API types,lint,snapshot pass. Next is derived financial closure and bilingual staff/customer flow,then final coverage/review/CI for the whole batch. #327 full-main run35551479937 remains live.

### Live cancellation financial status and CI cleanup

Staff/customer status endpoints derive pending,needs-attention,closed or unverified financial outcome separately from Cancelled service state. Customer reads enforce active profile and publication; output excludes staff/approval details. Validation passes38 cancellation/customer-review HTTP cases plus5 config-cache integration cases,API types,lint,OpenAPI consistency. UI and final coverage/review/CI remain.

Full main #327 run35551479937 failed only on an uncaught connection termination from config-cache fixture forced-drop cleanup,despite317 API test files passing. The fixture now waits for idle connections to disappear before ordinary DROP and closes management in finally. Local focused validation passes; remote full-CI confirmation remains. Other four gates succeeded. Do not record that run as green.

### Cancellation interface built and locally validated

Current contract detail now includes bilingual cancellation/financial status. A latest-decision endpoint returns a stable JSON envelope for empty/saved decisions and supports reload during second approval. Staff permission flags gate actions; historical versions remain read-only. Explicit decisions,step-up,idempotent retry,stale/payment blockers and final irreversible confirmation precede status refresh. Customer status separates cancellation from completed returns. Local validation passes22 frontend tests,39 cancellation/customer HTTP tests,2 production Chromium flows,API/web types,lint,OpenAPI and build. Next is actual committed combined coverage,broader browser evidence/render inspection,exact-head review and CI before the full cancellation PR can merge. No supervisor completion history changed.

### Finance obligation queue and exhausted retry

Requirement review found and fixed a missing exhausted-refund retry. Finance now has a paginated bilingual queue for unresolved wallet/bank obligations. Manual retry records one-time authorization,checks current finance permission,preserves exhausted automatic history and posts at most one ledger credit. Bank transfer/reconciliation controls use the existing separate-user guard. Local validation passes52 HTTP,36 DB and4 bilingual production-browser cases,types/lint/OpenAPI;Persian rendering inspected. Next is combined coverage and final review/CI. No batch completion is claimed.

### PR #328 merged; customer cancellation requests selected

Cancellation/refund PR #328 merged as `9960e956e105f0d8067cfbe8b6e52f67da4da41e` after exact-head approval and all five CI gates passed in run35555563804. Both merged head and durable review were verified again after merge. Actual local combined coverage and17 production browser cases pass. Remote API regression passed319 files/5344 tests. Full main run35556867140 remains pending. The prior #327 run35554299044 is also still running; do not conflate it with the known failed run35551479937.

Next batch is `04-invoices-wallet-contracts.md#T-04.5.01.06` on `codex/customer-cancellation-requests`, based on the verified #328 merge. Customers submit a reason and destination preference without directly cancelling. Staff rejects with explanation or uses the existing approved cancellation/refund transaction to fulfil the request. Keep request/financial states truthful, enforce profile/current authority, and provide bilingual review/status UI. No scheduler or historical supervisor state changed.

### Customer cancellation request backend validated

The next branch now has migration0146 and customer submit/read,staff queue/read/reject endpoints. An optional immutable request binding on cancellation intent makes approved execution fulfill the request atomically; rejection invalidates the saved decision. Customers cannot directly cancel or create refunds. Independent terminal outcomes read as Closed. Local checks pass51 HTTP and33 migrated DB/upgrade cases,API/DB types,lint,OpenAPI and snapshot consistency. The bilingual interface,coverage,independent review and CI remain; keep the complete workflow in one PR.

### Customer request interface validated; proxy fixture repaired

The request workflow now has bilingual customer submission/status and staff queue/review controls. Local58 frontend tests and8 production browser flows pass alongside60 API coverage cases,types,lint,build,budgets and static security. Commit-bound combined coverage and independent review/CI remain.

Full main #328 run35556867140 passed tests/security but failed before browser execution: the proxy test upload received502 because the fixture responded before consuming its body. The fixture now consumes before responding; the probe verifies all11MiB were received. The complete local proxy probe passes. Missing browser evidence caused the downstream combined-coverage failure; do not claim the old run green.

Correction: run35554299044 is the separate scheduled **Nightly browser checks**,not a main CI rerun. It failed20 mobile Chrome and6 Firefox cases in existing theme/contrast/font/OTP/CSP coverage;mobile Safari/WebKit were cancelled. Keep this as an explicit follow-up after the customer request batch;no cross-browser cleanliness is claimed. Detailed failed log is `/tmp/barghsa-main327-rerun-failed.log`.
