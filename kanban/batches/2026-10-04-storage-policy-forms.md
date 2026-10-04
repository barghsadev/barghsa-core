# Storage and upload-policy forms, October 4, 2026

## Kanban scope

This batch advances `07-ui-ux-design.md#T-07.10.01.02`, `.04`, `.05` and `.06` across storage configuration, multipart cleanup and upload-policy editing together. Domain context is `05-notifications-documents-ai.md#T-05.09.03`, `02-auth-users-admin.md#T-09.12.05` and `07-ui-ux-design.md#T-07.30.02.12`. Existing storage adapters, upload enforcement and version history are not counted as newly built. The canonical storage draft/active/superseded lifecycle and global form parents remain partial.

## Behavior and review

Both editors use the existing deferred shared validator, bilingual owned feedback, linked errors and first-invalid-field focus. Validation retains valid companion values. Storage preserves saved credentials when the password input is blank, requires reentry when changing location, and makes credential removal explicit. Cleanup accepts whole hours from 1 through 168. Upload policies enforce deployment-permitted formats and exact whole-byte limits, including fractional MiB input.

A synchronous owner protects validation and captured confirmation. Refresh can cancel pending validation but cannot race a submitted command. Failed reads retain drafts; changed saved settings withdraw stale confirmation and require explicit reset. Unknown save receipts and lost responses freeze further writes until a fresh authoritative read and explicit reset. Successful receipts must match the captured public values and expected storage/cleanup version. Permission denial clears private state and invalidates late callbacks.

Storage and cleanup have separate drafts, so saving cleanup retains unsaved storage credentials. API field errors expose only known public names after permission/step-up checks. Raw validation messages and secrets are not echoed. Password step-up, optimistic versions, storage probes, encryption, deployment ceilings and transactional audits remain enforced. Deploy the additive API field-error responses with or before the frontend. No migrations or dependencies are needed.

## Validation

- Web: 440/440 across six related files, including 21 new cases; `/tmp/barghsa-storage-web-final.log`.
- API: 72/72 across five files, including seven new cases and real HTTP/database validation; `/tmp/barghsa-storage-api-tests.log`.
- Dictionaries: 77/77; `/tmp/barghsa-storage-dictionary.log`.
- Build: seven tasks pass; types: 11 tasks pass. Lint, formatting, contract and suppression checks pass. Logs use `/tmp/barghsa-storage-` prefixes.
- All 84 unchanged bundle budgets pass; storage is 378.25 KB/500 KB and upload policies 384.19 KB/500 KB. `/tmp/barghsa-storage-budgets.log`.
- All 28 distinct production browser cases have passing evidence, including 12 new and eight real-API flows. Both languages/themes, RTL, linked focus, retained credentials, owned server feedback, recovery, Axe and mobile bounds are exercised. Persian dark Chromium/Safari forms are visually inspected; locator captures can be clipped by the sticky mobile shell.
- Final affected runs pass six Safari form cases and four upload-retry cases. Earlier runs prove six Chromium form cases, four storage-retry cases and eight live flows. Larger interrupted/failed runs are not represented as whole-run successes. Dialog scans wait for actual animation completion, and the old upload fixture waits for its mocked failed read before asserting recovery UI.
- Final pinned strict security passes all five rule fixtures and scans 1,597 files with zero findings and zero scanner errors. The earlier scan returned 11 scanner errors and was not accepted; the isolated final run passes without changing scanner settings or exclusions.
- Backlog validates 1,355 tasks and 116 traceability entries. Generated queue/coverage ledgers, supervisor history/state and scheduler remain unchanged.

## CI reconciliation

Terms commit `993beb72fe5f7a820cbcac82be97ebdfd30d3c8c` [run 37158121901](https://github.com/barghsadev/barghsa-core/actions/runs/37158121901) failed one of 3,028 web tests. The SMTP draft test inspected fetch calls before asynchronous validation completed. It now waits for the actual PUT and successful editor closure, preserving the exact request assertion. All 380 boundary cases pass in the 440-case run. The dependent combined-coverage gate also failed; neither failed gate is claimed successful. CI settings and production receipt guards are unchanged.

Old browser fixtures now persist the actual locale, return complete matching save receipts, and distinguish definite rejection from an unknown write. Their password verification, retained captured commands, opposite numeral preferences and denial assertions remain. Real storage flows also verify cleanup-policy persistence and reload.

## Commands

- `pnpm --filter @barghsa/web test src/pages/admin-boundaries.test.tsx src/pages/storage-policy-forms.test.tsx src/pages/AdminStorageConfig.test.tsx src/pages/policy-catalogue-recovery.test.tsx src/pages/content-forms.test.tsx src/components/TeamActionDialog.multipart.test.tsx`.
- `pnpm --filter @barghsa/api test src/storage/storage-config-http.integration.test.ts src/admin/upload-policy.controller.test.ts src/admin/upload-policy-http.integration.test.ts src/admin/upload-policy.service.test.ts src/upload/upload-policy.resolver.test.ts`.
- `pnpm --filter @barghsa/i18n test`; `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm format:check`; `pnpm check:contract`; `pnpm check:suppressed-errors`; `pnpm check:bundle`.
- Browser command uses `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm --filter @barghsa/web exec playwright test storage-policy-forms.spec.ts storage-config.spec.ts upload-policies.spec.ts admin-settings-live.spec.ts --grep 'storage and policy|storage editor|upload policy editor|storage configuration persists|upload policies edit' --project=chromium --project=mobile-safari --workers=1`.
- Strict scanner uses `PATH=/Users/majid/.cache/barghsa-security-scanner-313/bin:/usr/local/bin:/usr/bin:/bin python3 scripts/check-sast.py --report /Users/majid/.local/state/barghsa-manual-batches/storage-forms/sast.json`.
- `python3 kanban/scripts/build_backlog.py --check`; `git diff --check`.

## Evidence retention

The host interruption removed the earlier temporary logs. Their verified command output remains in this chat, and the unchanged production source predates the verified build. Final affected browser evidence is retained outside the checkout in `/Users/majid/.local/state/barghsa-manual-batches/storage-forms/browser-safari.log` and `browser-upload-retries.log`. Formatting and strict security evidence use that same directory. No passing results are inferred from the interrupted runner.

## Publication and remaining work

Publish directly to main after review and checks, then read back local/origin/remote/GitHub SHA agreement, clean checkout and exact-commit CI registration. No PR is created. Remaining staff configuration and AI forms are candidates for the next batch; global form parent tasks remain partial.
