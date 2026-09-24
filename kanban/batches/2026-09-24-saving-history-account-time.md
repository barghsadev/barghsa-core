# Saving history in the account timezone

Canonical scope: `07-ui-ux-design.md#T-07.09.01.05`, applied to saving-order history and shared order conversations.

Customer saving-order lists and details now display submission and fulfillment dates in the saved account timezone. Staff fulfillment events, customer and staff comments, and saving revision, address and hardware amendment histories use the same account-aware formatter. Each screen reads the timezone once and passes its formatter to child histories. The shared electricity comments also receive the formatter from their parent screens, removing their browser-timezone display. A failed timezone read exposes the existing retry notice instead of silently showing a different date.

Validation: focused saving-list, staff-saving and staff-electricity tests pass. The saving browser journey passes with an account timezone of UTC+14 and confirms a UTC September 23 submission appears as September 24 on both order detail and list. Staff fulfillment and bilingual electricity browser journeys pass. Web typecheck and formatting pass.
