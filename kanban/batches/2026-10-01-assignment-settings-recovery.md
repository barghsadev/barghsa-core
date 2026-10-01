# AI slot and staff response target recovery, October 1, 2026

## Kanban scope

`07-ui-ux-design.md#T-07.18.01.06`: adopt shared ListPage composition for AI slot assignments and staff response target settings. Existing agent-slot domain work (`T-07.30.02.08`) is not counted as newly built. Response targets cover the existing ticket and identity-verification types only; wider priority, order, contract and escalation work under `T-07.30.02.15` remains open. The all-list parent and remaining filter/search/sort/URL work stay partial.

## Behavior and review

Accepted assignments and local slot choices survive independently retried slot and agent reads. Target edits and pending password confirmation survive transient failure. Required reads pause confirmation until recovery. Fresh assignment versions, selected agent configuration or sharing changes invalidate obsolete review. Changed saved assignments or targets retain local drafts but require an explicit reset before saving. Withdrawn agents remain visible as unavailable choices. Slot changes cannot enable a disabled agent.

Assignment acknowledgements must match the selected slot, agent, reviewed title/enabled state and sharing. Unassignment requires a null-agent receipt. Target acknowledgements require the exact confirmed complete map. Accepted save receipts supersede older reads and cannot cross a changed resource path or permission epoch. Saving one slot preserves unrelated choices. Permission denial clears private accepted data, drafts and review; delayed read, password and command responses cannot restore it. Existing password step-up, CSRF and server permission enforcement remain supported.

Both settings screens use shared ListPage loading/error retention and accessible recovery controls inside and outside confirmation. Final focus returns to the outside refresh button. Persian/English dictionaries, mobile form bounds and light/dark rendering are covered. Existing browser fixtures now use authenticated staff context, persisted locale and complete API DTOs.

No backend, database, dependency, scheduler or CI configuration changes are included. Client invalidation responds to accepted fresh metadata; no server version-lock protocol is introduced. Automated accessibility checks cover the dialog content while open and the full page after closing. Base UI's external VoiceOver focus sentinels produce unnamed-button Axe warnings in mobile Safari; they are outside the scoped modal-content scan and this batch does not alter the dependency.

## Validation

Final related web validation passes 509 cases: 45 new settings cases, one shared receipt/race case, 380 admin-boundary cases, the multipart dialog case and 82 existing contract/VAT/knowledge/CRM recovery cases. All 53 dictionary cases pass. Final root build/typecheck, all 64 route budgets, contract and suppression checks pass. Final root lint and all 24 production browser scenarios pass across Chromium/mobile Safari. Sixteen new bilingual light/dark scenarios cover retained drafts/passwords, independent reads, stale reset, denied recovery, focus restoration and mobile field bounds. Axe reports no violations within the stated dialog-content/full-page scopes. Persian screenshots are inspected. Final formatting/backlog/diff checks pass. The pinned static security scan passes all five rule fixtures and scans 1,316 files with zero findings or scanner errors. No full-web-suite or measured combined-coverage claim is made.

## Commands

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:bundle`, `pnpm check:contract`, `pnpm check:suppressed-errors`
- `pnpm --filter @barghsa/web exec vitest run src/pages/assignment-settings-recovery.test.tsx src/hooks/useCatalogueResource.test.tsx src/pages/admin-boundaries.test.tsx src/components/TeamActionDialog.multipart.test.tsx src/pages/contract-settings-recovery.test.tsx src/pages/vat-recovery.test.tsx src/pages/knowledge-policy-recovery.test.tsx src/pages/crm-recovery.test.tsx`
- `pnpm --filter @barghsa/i18n test`
- `BARGHSA_TEST_PREBUILT=1 node scripts/run-production-browser.mjs assignment-settings-recovery.spec.ts agent-slots.spec.ts service-targets.spec.ts --project=chromium --project=mobile-safari --workers=1`
- Pinned external scanner: `/tmp/barghsa-security-scanner-313/bin/python scripts/check-sast.py --report /tmp/barghsa-assignment-static-security-final.json` with its environment on PATH
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`

## Publication

The preceding provider batch is published as `ce887033844d111ee7ea3bbee38cb9478677b09e`. CI run `36840973870` passes all five jobs under the existing temporary fast mode; combined-coverage success remains an exemption, not measured coverage. Its progress records are updated.

This assignment-settings batch is published directly to main after review and final validation. Remote SHA and CI availability are read back after publication; no remote CI success is claimed without a registered, passing run. No PR is created. Historical supervisor state remains unchanged.
