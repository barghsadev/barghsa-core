# Nightly browser repairs

Follow-up to scheduled run35554299044, related to `01-platform-infrastructure.md#T-05.05.01`. Branch `codex/nightly-browser-repairs` started from reviewed PR #329 HEAD `c85bb7d77f4db20af70b9d9db310c2fa88c37c8d`. That PR is now verified merged as `f1d74a3d8a4962f542c2c2d80f44a0ffd7512c21`; rebase this batch onto it before opening a PR. This repairs browser validation, not every separate nightly-schedule requirement. No supervisor state is changed.

The reproduction found browser-specific fixture assumptions and unresolved CRM contrast checks. Preserve every browser project and accessibility requirement. Do not disable failing tests or accept unresolved contrast as a pass.

Implemented so far:

- Give the theme fixture the application's device-width viewport. The missing setting produced a 980px layout on a 393px mobile viewport and incorrect toast positioning assertions.
- Allow equivalent quoted CSS font-family serialization and subpixel separator measurements.
- Supply a portable synthetic paste payload. A direct runtime probe showed Firefox discards the DataTransfer passed to ClipboardEvent; Chromium and WebKit retain it. Existing OTP request, normalization, error, reset and focus assertions remain.
- Assert registration benefits are hidden below the existing 768px responsive breakpoint and visible above it, while retaining the full registration interaction.
- Open the mobile navigation to check its visible labels, then close it before checking form interactions. Content and navigation each retain violation and incomplete-contrast checks.

Validation checkpoint: the first focused run passed38 of39 cases across Firefox, WebKit and mobile Chrome. The only failure was WebKit's equivalent unquoted Inter Variable font serialization, now corrected. A second focused run is checking fonts, navigation contrast and native CSP transport. Full validation, CRM contrast repairs, independent review and CI remain.

Follow-up validation: all15 font/navigation cases pass across Firefox, WebKit and mobile Chrome. Native CSP tests now verify the document's session cookie independently, then assert observed engine transport: Firefox omits report cookies, WebKit uses fetch destination empty, and Chromium uses report with the same-origin cookie. All10 signed-in/signed-out CSP cases pass across all five browser projects. Server session-CSRF protection is unchanged.

CRM geometry confirms vertical clipping by the scrollable main content: wrapped mobile tabs extend below its bottom edge, and the session table can be below the desktop viewport. The shared contrast helper now proves clipping against viewport and scroll ancestors before revealing each affected node and requiring a clean contrast rescan. It retains all measured violations and rejects incomplete results that cannot be explained by clipping.

The Persian Firefox session reference also touched the table's right edge with fractional text geometry. Scrolling alone did not resolve it. Horizontal cell padding does, and the Persian table was visually inspected. The five-project CRM run passed39/40. Mobile Safari's English dark case timed out during initial navigation and context shutdown, before any network record or CRM assertion. Repeating the four mobile Safari variants reproduced the fourth-case startup timeout. Investigate it separately from contrast; do not call the whole suite clean. Final batch coverage, independent review and CI remain.
