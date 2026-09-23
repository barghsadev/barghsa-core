# Persistent language and direction

Canonical scope: `07-ui-ux-design.md#T-07.03.02.01`–`.02`.

Switching between Persian and English now updates the current page and stores the choice in both local storage and a year-long same-site cookie. The client resolves a short-lived entry-navigation handoff first, then the saved preference, then the browser's supported language before React renders. It sets both `<html lang>` and `dir`, so a resumed order or request stays in the chosen language after a hard reload. Playwright's default locale is explicitly Persian to preserve the existing Iranian-market test baseline; a separate English-browser case verifies detection and persistence. Existing browser journeys were updated to expect their language selection to survive reloads and later visits.

Validation: two focused browser journeys pass across Chromium, Firefox, WebKit, mobile Chromium, and mobile Safari. Thirteen related Chromium cases pass across login, electricity, saving, solar, and consultation. Three focused locale unit tests, web TypeScript, production web/auth builds, changed-file lint and format, and backlog validation pass. The login accessibility scan excludes only the development router tool so its contrast check remains focused on the application.
