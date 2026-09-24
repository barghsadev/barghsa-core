# Electricity workflow timestamps

Canonical scope: `07-ui-ux-design.md#T-07.09.01.05`, completing the order-review and customer-change surfaces that use electricity timestamps.

The staff electricity review queue now shows submissions, conversation activity, delivery periods, and before/after revision periods in the saved account timezone. It displays the last included delivery day for half-open periods. The customer order timeline, quantity-increase panel and price-adjustment panel use the same account-aware formatter; the detail page passes it to child panels so those panels do not make duplicate timezone requests. A standalone panel still formats in the explicit Tehran default instead of the browser timezone.

Validation: focused staff-order, price-adjustment and quantity-increase tests pass (10 tests); web typecheck passes. The staff-order test checks a Tehran midnight boundary and final included day.
