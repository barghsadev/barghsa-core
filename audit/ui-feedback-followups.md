# UI feedback review

Status: missing application renderer repaired and locally verified. Public UI package pairing remains open.

## Reproduction

The app called Sonner notifications but mounted no Toaster. A controlled successful registration-verification response produced one request and redirected to `/`, with zero toast containers and no visible success. All four new Chromium locale/theme checks failed before the renderer was added. No real account or external provider was used.

## Repair and review

The root now mounts one localized Sonner renderer. It follows configured light/dark mode, uses Persian RTL or English LTR, names its live region and close button, survives ordinary navigation, and dismisses existing messages when its profile context unmounts. Login and registration retain existing inline errors without duplicate toast announcements. Dashboard header and navigation now show the configured company title.

Adding the renderer initially exceeded login and ordering payload limits. A native keyboard-accessible trust-device checkbox replaces the unnecessary widget dependency. Application translations have a separate entry point; authentication consumers retain their dedicated or compatibility entry point. A before/after comparison verified identical public dictionaries for all 909 keys in each language. No payload limits changed and the renderer remains in the measured initial payload.

## Validation

- Fresh production build and all 41 complete-route gzip checks, including the actual Size Limit CLI, passed. Login is 145.59 KB against 150 KB.
- 160 repeated browser checks passed across Chromium, Firefox, WebKit, mobile Chrome and mobile Safari. These verify locale/theme, visible success after redirect, keyboard dismissal, exact trusted-device request values and authentication retry behavior.
- 85 additional checks passed across those five projects, including expired-code error messages after redirect, configured dashboard titles, profile-switch races and branding validation.
- All 155 web unit tests and 45 translation tests passed. Web types, lint, formatting and diff whitespace review passed.
- First browser attempt had 77 passes and three contrast failures measured during the entrance fade. Tests now wait for the toast's computed opacity to reach one before measuring settled text. The repeated run found no contrast violations or unresolved contrast nodes. This does not certify readability during transient fades or every application journey.

The UI package still exposes a Sonner Toaster with a Base UI toast manager. Current app callers import Sonner directly. That independent public API defect is the next repair, not closed by these browser results.
