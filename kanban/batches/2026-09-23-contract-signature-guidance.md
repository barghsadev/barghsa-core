# Contract guidance and customer workflow checklist — September 23, 2026

Canonical task: `03-core-business.md#T-03.90.18`.

The customer contract banner now uses the signature panel's current server response to identify when the customer can prepare or record a signature. It links directly to that panel and reports the latest signature request or recorded signature as the recent event. Acceptance keeps priority while it is available. This fixes the prior misleading "waiting for staff" guidance when the customer had a signature action available, without adding a second signature request.

The [workflow guidance checklist](../WORKFLOW-GUIDANCE-CHECKLIST.md) records the five review questions and current customer-detail coverage. Focused tests cover next-action selection and the panel-to-banner status handoff; the standard web checks cover the rest of the interface.

Validation: 974 web tests, web typecheck and production build, targeted lint and formatting, and backlog validation passed locally. CI is pending after the direct `main` push.
