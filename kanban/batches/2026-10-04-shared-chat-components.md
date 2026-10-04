# Shared customer and admin chat components — October 4, 2026

## Scope and task identity

This manual batch implements the shared message, input and welcome components together, integrating them into the existing customer guide and staff agent test chat:

- `07-ui-ux-design.md#T-07.20.01.02`: user/AI message bubbles, expandable knowledge/document/excerpt citations, public policy badges and message timestamps.
- `07-ui-ux-design.md#T-07.20.01.03`: growing input, disabled pending sends, contextual suggestions and Enter/Shift+Enter behavior.
- `07-ui-ux-design.md#T-07.20.01.04`: named welcome when available, starting prompts and active profile context.
- Integration advances `07-ui-ux-design.md#T-07.21.01.01` and `05-notifications-documents-ai.md#T-05.21.02`. Their wider assistant and agent workflows remain partial.

The shared components are owned by the web application; no package dependency or public package export is added. This report records the implemented acceptance slices without changing the generated queue, coverage ledger or historical supervisor snapshot.

## Implementation and review

Both interfaces use `ChatMessage` and `ChatInput`. Customer welcome and suggestions use `ChatWelcome` and `ChatPromptSuggestions`. User bubbles use the brand background; incoming messages use the muted background and logical alignment/corners for RTL. Customer knowledge replies retain their guide caption and public citations/policy categories. Staff replies have an AI-message caption; their private response metadata remains in the dedicated admin panel. Direct account reads have their own account caption and never become inference results. Stored content remains escaped React text.

Every new message has an honest timestamp. The customer guide preserves the backend answer time and shows legacy missing times as unrecorded. User messages keep their original send time through captured retries. Staff answers and direct account cards show client receipt time, explicitly labeled as received; they do not invent server generation times. Formatting follows the existing account timezone and locale hook. Timestamps do not enter request bodies.

The shared input forwards the owning form reference, validation handlers and ARIA attributes. It grows to 240 pixels, scrolls longer drafts and returns to its minimum height after successful submission. Enter submits the owning form once, Shift+Enter retains newlines, and modern composition plus legacy key code 229 do not submit. A blocked send also prevents an unintended Enter newline while keeping the cooldown draft editable. Mouse-down preserves the textarea focus so WebKit scroll restoration cannot move the send target before the click; mobile taps remain covered.

Customer suggestions remain three to four profile-aware choices. They select a draft without submitting or forwarding account paths/data to inference. A name is used only when already available; the existing general greeting remains otherwise. Account actions continue to read the protected dashboard separately. Existing request capture, exact retry IDs, pending duplicate guards, cooldowns, owned server feedback, permission withdrawal and private-history clearing remain intact.

Review repaired an initial JSX accessibility lint conflict by naming the component property `sender`, and corrected the admin caption so test-agent replies do not claim to be guide answers. English light desktop and Persian dark mobile captures were inspected. Native disclosures, source markup escaping, Axe checks and mobile bounds remain covered.

No API, database, migration, provider contract, endpoint path, dependency, CI configuration or supervisor-state change is required.

## Validation and evidence

All 110 distinct related unit/dictionary cases pass, including seven new:

- Web: 108 cases across seven files in `web-tests-final.log`, covering shared components, chat forms, response metadata, knowledge parsing, agent forms and account time. The seven shared-component cases pass again after the final caption adjustment in `web-components-caption.log`. New cases cover keyboard/composition/locked sends, forwarded references/resizing, escaped sources and public metadata, legacy missing times, suggestion ownership and direct account receipt identity.
- Dictionary: both bilingual cases pass in `i18n-tests-reviewed.log`, with the existing key contract expanded for user/AI/account message names and sent/received labels.
- Production browsers: all 58 distinct Chromium/mobile Safari scenarios pass in `browser-reviewed.log` / `.json`, including eight new customer/admin × language × browser combinations. All 12 directly affected scenarios pass on the final production build in `browser-caption.log` / `.json`; these repeats are not added to the distinct total. There are no skipped, flaky or unexpected cases. Coverage includes real keyboard submission, composition, growing/reset inputs, 503 retry identity, original send time versus receipt/server time, welcome prompts, account privacy, denial, server feedback, RTL, Axe and mobile bounds. Eight final captures are retained externally.
- Root `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass in their `*-reviewed.log` files. Final affected build/types/lint pass in the `*-caption.log` files. `pnpm check:bundle` passes all 84 unchanged budgets in `budgets-caption.log`.
- Strict security passes all five fixtures and scans 1,627 files with zero findings/errors in `security-verified.log` / `.json`. A preceding scan reported one parser warning on the unchanged main dictionary; the full serial retry cleared it. Both results are retained, and the scanner was not weakened.
- Final documentation formatting, `python3 kanban/scripts/build_backlog.py --check` and staged `git diff --check` are required before publication and recorded externally.

The web command is `pnpm --filter @barghsa/web exec vitest run src/components/AssistantChatComponents.test.tsx src/components/assistant-chat-forms.test.tsx src/components/response-metadata-panel.test.tsx src/lib/assistant-chat.test.ts src/lib/knowledge-assistant.test.ts src/pages/ai-agent-slot-forms.test.tsx src/hooks/useAccountTime.test.tsx`. Production browser arguments and individual outcomes are retained in the Playwright JSON reports. Unchanged API tests from the preceding batch are not rerun or counted as current evidence.

Evidence and publication records are stored at `/Users/majid/.local/state/barghsa-manual-batches/shared-chat-components/`. Results are read from completed commands; remote CI completion is tracked separately.

## Remaining work and publication

The three shared-component acceptance slices are implemented. The larger assistant sheet/launcher, streaming (`07-ui-ux-design.md#T-07.20.01.05`), trusted write confirmations (`#T-07.20.01.06`), production staff assistant/tool integration and global form adoption remain separate work. Existing customer account reads remain read-only.

Publication is a conventional commit directly to main, with local/origin/advertised/GitHub SHA agreement, clean status and exact-commit CI registration recorded externally. No PR is created. The preceding metadata commit is `58b0686f3e3085c011135527bc399537ee2c7667`; its CI is tracked separately. The earlier forms commit's CI was cancelled by a later push and is not counted as passing.
