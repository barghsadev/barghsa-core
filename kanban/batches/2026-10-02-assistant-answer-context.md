# Customer guide answer context, October 2, 2026

## Task coverage

- `07-ui-ux-design.md#T-07.20.01.02`: builds the missing policy badges and AI answer timestamps in the existing shared customer chat panel. User timestamps now use the account timezone. Existing literal answer text and expandable KB/document/excerpt citations are retained.
- `07-ui-ux-design.md#T-07.20.01.03`: supplies three or four contextual questions for electricity, savings, solar, wallet, invoices, contracts, documents, tickets and consultations. Other pages use individual/company starting questions. The existing secure account-status action handles actual balances and invoice counts independently of the knowledge model.
- `07-ui-ux-design.md#T-07.20.01.07`: Persian/English prompts, policy labels, counts, recovery text and account-zone dates. Persian timestamps use the Persian calendar.
- `07-ui-ux-design.md#T-07.20.01.01`, `07-ui-ux-design.md#T-07.20.01.04` and the customer portion of `07-ui-ux-design.md#T-07.20.01.08`: validate the existing floating RTL/LTR sheet, full-page guide, profile greeting and profile isolation with the new metadata. These are preserved features, not three new implementations.

## Build and review

Customer answers expose only policy categories and the number of successfully evaluated policies in each category. Policy identifiers, administrative titles, priority and rule contents stay private. The seven existing policy kinds continue to run through the same inference checks. Blocked questions and policy rate limits no longer return private policy references to customers. A registered bilingual customer error explains policy denial and allows a different question or support contact.

The database saves the completion time and response metadata in the same update. Authorized retries return the saved answer and time without another provider call. Policy changes do not relabel old answers with the current configuration. Older cached responses use their existing completion time and report policy checks as unrecorded. Older API responses with missing metadata show explicit unknown states. An empty check list means no additional policies were assigned; unknown, malformed or future metadata never becomes a claim that checks passed. No schema migration is required.

Prompt selection uses the page's service category, with no route identifiers, profile data or balances added to model requests. Clicking a prompt fills and focuses the draft; sending still requires an explicit send/Enter action. Suggestions remain accessible through a native disclosure after a conversation begins and close when a question or account read starts, preserving room for the answer on mobile. Inputs and prompt buttons remain disabled while working; retry retains the same request and question. Profile changes unmount the previous conversation and aborted responses cannot attach old answers or policy metadata to the new profile.

Review fixes timestamp contrast, the full-page guide's nested main landmark and the workspace link's missing accessible name when branding fails to load. The existing browser fixtures now supply the account timezone, set the requested language preference and open/close mobile navigation when selecting a profile. Tests retain account permission, source, request-payload and profile-isolation assertions.

## Validation

- Root build passes; the final web build includes the reviewed mobile disclosure. All eleven root TypeScript tasks, ESLint, formatting, contract, suppressed-error, all 68 unchanged gzip budgets, snapshot, backlog and diff gates pass before publication.
- `BARGHSA_TEST_PREBUILT=1 pnpm --filter @barghsa/api test src/ai-agents/ai-knowledge-chat-http.integration.test.ts src/ai-agents/ai-test-chat-policy.test.ts src/ai-agents/ai-test-chat-http.integration.test.ts src/common/error-http.integration.test.ts`: 32 passing cases. Real HTTP/database cases cover all seven policy kinds, duplicate-kind counts, private metadata/error projection, saved timestamps, unchanged replay, configuration changes, legacy cached responses, source revocation, profile changes, quota, capacity, CSRF, provider budget and audit behavior.
- `pnpm --filter @barghsa/web test src/lib/knowledge-assistant.test.ts src/hooks/useAccountTime.test.tsx src/pages/ContractsNavigation.test.tsx src/pages/DocumentsNavigation.test.tsx`: 30 passing cases. Unknown or malformed metadata and route boundaries, including prototype-named paths, have explicit coverage.
- `pnpm --filter @barghsa/i18n test`: all 67 cases pass. These commands cover 129 distinct unit/HTTP cases; repeated runs are not counted twice.
- Production browser verification runs `e2e/knowledge-assistant-metadata.spec.ts` and `e2e/knowledge-assistant.spec.ts` on Chromium and mobile Safari. Twenty-two distinct scenarios pass across the final run and the targeted rerun of the corrected mobile-navigation fixture. They cover bilingual contextual drafting, keyboard behavior, disabled inputs, exact request payloads, recorded timezone/calendar values, policy counts, older/no-policy answers, literal markup, exact retry, denial recovery, late answers after profile switches and the existing account/source flows. Axe checks and mobile bounds are included.
- Strict Semgrep 1.176.1 scans 1,457 files with zero findings/errors; all five security rule fixtures pass. Evidence logs use `/tmp/barghsa-assistant-*`; The previous solar commit `20ba52ff` has all five GitHub CI jobs green. Exact-commit GitHub CI is read back after pushing this batch to main; its remote checks remain pending at publication.

## Remaining scope

Streaming responses (`T-07.20.01.05`), AI-proposed write confirmations (`T-07.20.01.06`) and a staff chatbot with role-scoped tools remain separate tasks. The customer model remains a published-knowledge guide; prompts do not imply that it can inspect an order, invoice or wallet. Policy badges describe checks recorded for an answer, not a guarantee about current configuration or future responses.
