# UI feedback review

Status: missing application renderer and public UI export pairing repaired and locally verified.

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

At the application checkpoint, the UI package still exposed a Sonner Toaster with a Base UI toast manager. The separate repair below closes that defect.

## Public UI export repair

A real DOM regression reproduced both `toast.success` and `toast.error` as missing functions when imported alongside the public Toaster. The public `toast` now uses Sonner, matching that renderer. Base UI is exported explicitly as `BaseToaster` and `baseToast`, with its provider, components and manager helpers exported as runtime values rather than type-only names. No current application caller used the mismatched root manager.

Review: all 13 UI tests pass, including actual success/error rendering and dismissal through the public exports and independent rendering through a Base UI manager. UI and web types, targeted lint, formatting, a fresh Vite build and all 41 complete-route budgets pass. Existing browser evidence in the preceding section applies to the unchanged application renderer. The export repair adds no application route behavior.
