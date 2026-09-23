# Saving order staff handoff browser batch — September 24, 2026

Canonical scope: the saving-order fulfillment portion of `03-core-business.md#T-03.90.14`.

The saving browser journey now continues after customer submission through staff review and the first fulfillment handoff. The staff interface approves the submitted order, which automatically completes request confirmation and moves product delivery into progress. Staff can find the order in the fulfillment lane, and the customer sees product delivery as the active stage before following the existing invoice and contract links. The test asserts that approval sends the expected version to the API. It no longer simulates staff progress by changing test state without using the UI.

Browser API responses are controlled fixtures; the separate saving-order HTTP integration tests cover backend transitions. This batch does not claim that the browser test exercises a live API.

Validation: focused browser journey in all five configured projects, web typecheck, targeted ESLint, formatting, and backlog validation.
