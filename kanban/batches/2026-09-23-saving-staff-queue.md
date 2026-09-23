# Saving staff queue access — September 23, 2026

Canonical scope: staff review and fulfillment access in `03-core-business.md#T-03.09.04.01` and `03-core-business.md#T-03.10.01.02`.

The staff saving-order queue previously returned only its first 100 active orders, prioritizing review orders. Fulfillment work could be hidden behind a large review backlog. The API now has review and fulfillment lanes and a stable older-page cursor for each, while its existing unfiltered response remains available. Staff can switch lanes and load additional orders without losing those already shown. Refresh and successful actions reset the queue so changed statuses appear in the right lane.

Validation: the real saving-order HTTP flow checks review and fulfillment membership, cursor behavior and malformed cursors. A staff page test checks both lanes and second-page retention. API/web typechecks, web production build, OpenAPI contract, targeted lint and formatting, and backlog validation passed locally. CI is pending after the direct `main` push.
