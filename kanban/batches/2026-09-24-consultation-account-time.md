# Consultation history and offer deadlines in the account timezone

Canonical scope: `07-ui-ux-design.md#T-07.09.01.05`, applied to the customer consultation journey and matching staff work queue.

Customer consultation lists and details now show submission dates, status history and the exact offer expiry in the saved account timezone. The staff queue and history use the same preference. The staff offer-expiry input now reads and submits wall time in that timezone, rejects nonexistent daylight-saving times, and preserves an unchanged stored instant. If the preference cannot load, the screen offers a retry and disables deadline editing instead of silently using the browser timezone.

Validation: focused conversion and staff submission tests cover a UTC+14 date boundary and a skipped daylight-saving time. The customer browser journey verifies the corresponding list and detail dates. Workspace build, typecheck, lint, formatting and backlog validation pass locally; GitHub CI runs on the pushed commit.
