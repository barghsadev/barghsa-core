# Release and launch plan

The first production launch includes **electricity, energy saving, solar and consultation**, with customer and staff workflows. All original requirements remain represented. Supported manual identity verification is the approved path; a nonexistent automatic identity provider is not a launch requirement.

`board.json` owns release/task assignments. Complete required task lists are grouped in [BOARD.md](BOARD.md). Query a milestone with `python3 kanban/scripts/board.py list --release 0.2.0`. Lists include verification of existing work, not just new code.

| Release | Goal | Required work and acceptance |
| --- | --- | --- |
| v0.2.0 | Complete customer journeys | Identity/profile boundaries, catalogues, simple/advanced electricity ordering, saving intake, solar intake and consultation. Finish the pending consultation patch, inspect wallet-history ownership, verify four intake journeys and group release announcements. |
| v0.3.0 | Staff operations and financial closure | Assignment, fulfillment, document/postal stages, revisions, contracts, invoices, receipts, cancellations, refunds, reconciliation and support. Verify money and concurrent retry boundaries. |
| v0.4.0 | Documents, notifications and AI | Safe processed/retained documents, templates, inbox/delivery, configured providers, knowledge retrieval, policies, slots and chat. Inspect existing consumers before building missing ones. |
| v0.5.0 | Usable and accessible product | Customer/admin adoption, Persian/English, RTL/LTR, themes, mobile/desktop, keyboard, forms, recovery and original performance budgets. |
| v0.6.0 | Production readiness | Resolve six policy/requirement decisions. Prove topology, TLS, secrets, migrations/seeds, providers/storage, security, coverage, load, backups/PITR, restore/rollback, monitoring and schedules. |
| v0.9.0 | Launch rehearsal | Freeze and validate all four services, complete operational/support ownership and rehearse recovery. Resolve every earlier launch-required criterion. |
| v1.0.0 | First production launch | After owner authorization, promote the accepted candidate and verify production journeys, monitoring and exact release receipts. |

Each milestone depends on its predecessor. Pull shared prerequisites forward when needed. Release business gates are mandatory in addition to task acceptance. Domain grouping does not excuse a broken earlier journey.

## Next release and first batch

The next release is **v0.2.0**.

1. Finish the uncommitted consultation patch under `release-readiness#R-01.03`. Preserve its 40 source and 30 distinct browser passes; reuse only matching evidence.
2. Inspect native wallet history under `release-readiness#R-01.02`. Confirm a missing ownership/access-recovery boundary before editing.
3. Renew identity and all-four-service acceptance under `release-readiness#R-01.01`. Inspect grouped criteria and existing journeys, then identify only real missing work.
4. Finish four intake journeys and announcement grouping. Accept the complete milestone before preparing v0.2.0.

The former v0.1.30 version and notes remain in the unfinished checkout for recovery. They were never published. Update final version/notes deliberately at the v0.2.0 boundary; do not deploy a batch merely because its tests passed.

## When can we launch?

Launch follows the accepted v0.9.0 rehearsal and authorized v1.0.0 promotion. A reliable calendar date is not available yet. Much code exists, but historical trackers do not provide a current complete acceptance census, and production prerequisites need external execution.

The first verification batch must identify exact remaining customer-journey build work. After each milestone, report completed criteria, remaining work, external blockers and an updated forecast. Estimate using observed durations of comparable accepted batches and confirmed gaps. Show external policy/provisioning time separately. Do not estimate by dividing 1,355 tasks by a token budget or treating every `verify` task as unbuilt.

Known prerequisites include recovery policy, callback/CSP boundaries, explicit schema/toolchain/UI requirement dispositions, current service acceptance, live providers/storage, production secrets/TLS, demonstrated backup/recovery, monitoring delivery and operational/support owners. Exact records live in the board. Preserve the six earlier owner questions; do not silently answer or repeatedly ask them without a concrete recommendation.

Launch requires every effective launch criterion accepted, four journeys and gates passing on a frozen candidate, required external evidence, no critical/major issue, and owner authorization. Build progress, staging health and launch readiness are separate facts.

Each accepted milestone deploys asynchronously to staging and gets one or two grouped Persian Telegram updates with reviewed images. Batches update main and the board without versions or announcements. An urgent compatible hotfix may use a PATCH version with the same acceptance and receipt rules.
