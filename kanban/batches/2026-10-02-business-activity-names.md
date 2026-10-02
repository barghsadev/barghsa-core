# Opt-in business activity names — October 2, 2026

## Task coverage

- `07-ui-ux-design.md#T-07.27.01.02` — actor-name support delivered in customer/staff electricity, contract and consultation history. Names come only from an explicitly chosen identity with separate business-activity consent. Existing roles and system events remain truthful fallbacks; opaque identifiers never become UI names. Invoice receipt actor provenance remains open because its immutable state-event rows do not record the actor. The parent task stays partial.
- `07-ui-ux-design.md#T-07.23.01.03` — existing shared support identities remain intact. The account editor adds an optional business-history name switch; support photos do not gain broader visibility.
- `07-ui-ux-design.md#T-07.27.01.07` — the switch and its audience/removal explanation are available in Persian and English. Other domain localization remains open.

## Build and review

Migration `0236_activity_identity_consent` expands the existing identity table with a non-null boolean defaulting to false, plus a constraint requiring a chosen name when sharing is enabled. Populated identities keep their previous values, revisions and timestamps; earlier migration checksums remain unchanged. Fresh databases and populated upgrades pass, and rerunning migrations applies nothing. The generated snapshot matches the schema and the journal timestamp follows the previous entry.

The existing self-owned settings endpoint keeps authentication, CSRF, current-session checks and account locks. Consent changes use the same revision, exact-retry and atomic audit rules as name/photo changes. Omitted consent preserves its existing value for older clients; clearing the name clears consent. The editor retains deliberate consent across failed saves and revision conflicts, clears it on name removal or account denial, and explains who can see the name. Missing fields from older reads default to false.

One shared batched query reads opted-in display names only for already authorized history authors. Disabled/inactive accounts and identities without consent yield no name; login fields, private profile/directory names, photos and unrelated identities are never projected. Contract lookup follows the selected version's visibility filter and 200-event bound. Publication uses its recorded publisher; automatic activation/completion remain system events. Customer consultation history still excludes actor IDs. Changing or revoking the identity takes effect on later history reads, including older events.

Names render as literal React text with bidi isolation in both customer and staff views. Review and browser checks cover mixed Persian/English names, markup-like text, role fallback, selection changes, consent removal and permission denial. The Persian dark mobile editor was inspected. A pre-existing consultation browser fixture raced its completion navigation; it now waits for the committed detail, closed dialog and selected URL before switching fixture context. No time-based sleep or test suppression was added.

## Validation

- `pnpm build` and `pnpm typecheck` — pass.
- With `BARGHSA_TEST_PREBUILT=1`, `pnpm --filter @barghsa/api test src/user-settings/conversation-identity-http.integration.test.ts src/contract/contract-review-http.integration.test.ts src/contract/contract-http.integration.test.ts src/electricity/electricity-order.integration.test.ts src/consultation/consultation-workflow.integration.test.ts src/consultation/consultation-request.integration.test.ts` — **131 passed** against real HTTP/PostgreSQL.
- `pnpm --filter @barghsa/web test src/components/ConversationIdentityDialog.test.tsx src/components/ContractStatusTimeline.test.tsx src/pages/electricity-order-details.test.tsx src/pages/admin-electricity-orders.test.tsx` — **31 passed**.
- `pnpm --filter @barghsa/db test src/conversation-identity-upgrade.migrated.test.ts src/conversation-identity-timestamps-upgrade.migrated.test.ts` — **2 passed**, including a populated upgrade, defaults, constraints, checksum preservation and reruns.
- `pnpm --filter @barghsa/i18n test src/messages.test.ts` — **25 passed**; full dictionary key/placeholder parity remains intact.
- **189 distinct affected unit/HTTP cases** pass; repeated runs are excluded.
- With `BARGHSA_TEST_PREBUILT=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173`, `pnpm --filter @barghsa/web e2e e2e/status-timelines.spec.ts e2e/conversation-identity.spec.ts e2e/consultation-journey.spec.ts --project=chromium --project=mobile-safari --workers=2 --max-failures=1` — **30 passed** on the final production build.
- With the same environment, `pnpm --filter @barghsa/web e2e e2e/status-displays.spec.ts e2e/staff-business-list-recovery.spec.ts --grep 'staff order statuses|consultation queue' --project=chromium --project=mobile-safari --workers=2 --max-failures=1` — **8 passed**. Covers staff name rendering/removal, draft recovery, denial, both languages, scoped Axe and mobile bounds.
- **38 distinct production browser scenarios** pass on final evidence; earlier failures/interrupted attempts are excluded.
- Root lint/format, OpenAPI contract, suppressed-errors, all **66 unchanged** bundle budgets, database snapshot, backlog and whitespace checks — pass before publication.
- Strict security scanner — all five fixtures pass; **1,432 files**, **0 findings**, **0 errors**.

## Publication and limits

Publish directly to main after validation, then verify local/origin/GitHub SHA, clean worktree and exact-commit CI registration. The preceding timeline batch's CI run `36984031828` has integrity, security and secret-history success; its test job remains running at the last readback. New remote CI remains pending at publication.

Deploy the expanding database migration before the updated API. No new endpoints or dependencies are required. Current names are display identities rather than immutable legal attribution. Receipt actor provenance and explicit solar construction delivery/installation records remain separate work. Historical supervisor state, scheduler, handoffs and CI settings remain unchanged.
