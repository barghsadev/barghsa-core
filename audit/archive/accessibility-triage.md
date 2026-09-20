# Accessibility and render-safety checkpoint

React Doctor 0.9.13, full scans of apps/web and packages/ui. Scoring, supply-chain checks and caching were disabled. These results do not establish dependency safety or a quality score.

| Measure | Baseline 38b6679 | Current repair |
| --- | ---: | ---: |
| Total diagnostics | 316 | 268 |
| Errors | 5 | 0 |
| Accessibility diagnostics | 43 | 1 |

Reports: [baseline](react-doctor-baseline-38b6679.json), [current](react-doctor-accessibility-checkpoint.json). Current scan covers parent 537d4fe plus the geography/TOS labels, administrator-control dictionary and breadcrumb correction committed with this document. Earlier 237-diagnostic audit used a different tool version/scope and is not directly comparable.

## Reviewed fixes

- OTP countdown updaters are pure; onboarding references update after commit; reminder confirmation owns its request guard.
- Notification, provider and ordering-address labels are associated with controls. Provider wrappers label both SMTP and Resend inputs.
- Notification/marketing settings block writes after failed or malformed reads and preserve drafts on failed or mismatched saves.
- Session-revocation dialogs contain focus, restore cancellation focus, protect pending requests and expose failures.
- Shared table sorting uses native keyboard buttons and aria-sort. Fixed columns remain visible, controlled selection updates work and callbacks run once under Strict Mode.
- Geography filters and TOS error dismissal have localized accessible names.
- Current breadcrumb text uses aria-current without impersonating a disabled link.

The 63 combined production-browser/component checks passed. They cover auth retry/cooldowns, drafts and profile forms, notifications/providers/preferences, session dialogs, ordering address labels, geography/TOS controls, date-picker boundaries and shared-table behavior. Build, type, lint and bundle checks also passed. See [repair-progress](repair-progress.md) for individual step evidence.

## Remaining accessibility diagnostic

src/components/ui/toast.tsx:118, shadcn-icon-button-requires-label: reviewed as a wrapper-analysis false positive. ToastClose renders its Button through ToastPrimitive.Close, which explicitly supplies aria-label="Close toast" before spreading caller props. The default control therefore has an accessible name. No suppression was added. The English default label still belongs in the wider localization review.

## Open work

The remaining 267 non-accessibility warnings are not blanket-approved. Some flag guarded asynchronous loads, intentional error-body parsing, small-array lookups or component size. Others point to workflows requiring source/behavior review. In particular, verification configuration still offers default state after load failure, and notification/TOS mutation guards need review.

This checkpoint does not certify every screen's screen-reader behavior, global RTL layout, non-picker timezone formatting, full translation coverage, administrator numeral preferences, future ordering flows or all historical task acceptance. Existing English geography/TOS content remains untranslated beyond the controls repaired here. All F01-F23 exit rules still apply.
