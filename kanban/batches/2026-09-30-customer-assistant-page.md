# Customer assistant full page

Canonical work: the full-page option in `07-ui-ux-design.md` S-07.20.01, reusing the existing profile-scoped conversation. This batch advances T-07.20.01.01–.04, .07 and .08 but does not complete the task-specific gaps: policy badges, auto-resizing input, personalized welcome and profile indicator, and staff-role scope. Streaming and AI write actions are separate tasks.

The `/ai` route now renders the same sourced conversation and direct account-status shortcut as the slide-over. A dashboard navigation link makes it reachable. The page checks the active profile's assigned agent slot, resets the conversation after a profile-context change, and shows explicit loading, unavailable and retryable error states. The floating launcher is hidden on the full-page route.

Validation: five Chromium knowledge-assistant cases, including the new full-page answer/source/unassigned flow and the existing Persian/English slide-over; 25 dictionary-message tests; web production build; root typecheck, lint, formatting, bundle budgets and backlog validation pass locally. Main CI runs after push.
