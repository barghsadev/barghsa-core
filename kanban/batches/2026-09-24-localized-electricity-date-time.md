# Localized electricity date and time selection

Canonical scope: `07-ui-ux-design.md#T-07.09.02.04`, with the language-switch behavior in `T-07.09.02.07` applied to date and time selection.

Advanced electricity ordering and order revision now use a shared `DateTimePicker`. The date control displays a Jalali calendar in Persian and a Gregorian calendar in English. The clock displays Persian numerals in 24-hour time and English 12-hour time with AM/PM. Both views edit the same timezone-aware instant, so switching languages does not alter a selected delivery period. The existing Jalali draft format remains compatible with saved drafts and the ordering API. The picker rejects wall-clock times that do not exist in its configured timezone.

Validation: all 16 Chromium date-picker cases pass, including new locale/clock and date-change cases; all three bilingual electricity journey cases pass through payment and contract tracking. The UI package's 58 tests and distribution checks pass. Workspace build, typecheck, lint, format and canonical backlog validation pass.
