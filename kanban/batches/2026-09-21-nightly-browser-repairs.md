# Nightly browser repairs

Follow-up to scheduled run35554299044. Branch `codex/nightly-browser-repairs` starts from reviewed PR #329 HEAD `c85bb7d77f4db20af70b9d9db310c2fa88c37c8d` while that PR awaits CI. Rebase this batch onto its verified squash merge before opening a PR. No supervisor state is changed.

The reproduction found browser-specific fixture assumptions and unresolved CRM contrast checks. Preserve every browser project and accessibility requirement. Do not disable failing tests or accept unresolved contrast as a pass.

Implemented so far:

- Give the theme fixture the application's device-width viewport. The missing setting produced a 980px layout on a 393px mobile viewport and incorrect toast positioning assertions.
- Allow equivalent quoted CSS font-family serialization and subpixel separator measurements.
- Supply a portable synthetic paste payload. A direct runtime probe showed Firefox discards the DataTransfer passed to ClipboardEvent; Chromium and WebKit retain it. Existing OTP request, normalization, error, reset and focus assertions remain.
- Assert registration benefits are hidden below the existing 768px responsive breakpoint and visible above it, while retaining the full registration interaction.
- Open the mobile navigation to check its visible labels, then close it before checking form interactions. Content and navigation each retain violation and incomplete-contrast checks.

Validation checkpoint: the first focused run passed38 of39 cases across Firefox, WebKit and mobile Chrome. The only failure was WebKit's equivalent unquoted Inter Variable font serialization, now corrected. A second focused run is checking fonts, navigation contrast and native CSP transport. Full validation, CRM contrast repairs, independent review and CI remain.

Follow-up validation: all15 font/navigation cases pass across Firefox, WebKit and mobile Chrome. Native CSP tests now verify the document's session cookie independently, then assert observed engine transport: Firefox omits report cookies, WebKit uses fetch destination empty, and Chromium uses report with the same-origin cookie. All10 signed-in/signed-out CSP cases pass across all five browser projects. Server session-CSRF protection is unchanged.

Unresolved: CRM checks must distinguish genuine layout defects from offscreen clipping and must reveal/rescan any clipped text. Profile tabs wrap, so their mobile failures must not be assumed to be horizontal overflow. The Persian Firefox session-table failure reports the table itself obscuring the session-reference cell; inspect its text geometry before changing CSS or assertions. No complete nightly pass is claimed.
