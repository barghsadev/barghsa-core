# Electricity period dates in the account timezone

Canonical scope: `07-ui-ux-design.md#T-07.09.01.05`, applied to the customer electricity journey.

The electricity order list and detail page now format submission and delivery dates in the saved account timezone and active language. The displayed final delivery day uses the last included instant of the half-open order period. A failed timezone read shows the existing retry notice instead of silently using the browser timezone. In the simple-order selector, Persian shows the Jalali month or week start; English shows the actual Gregorian date range, since one Jalali month can span two Gregorian months.

Validation: focused list tests cover a Tehran midnight boundary and the exclusive period end; the simple electricity browser journey passes through payment and contract tracking with an English Gregorian range assertion. Web typecheck passes.
