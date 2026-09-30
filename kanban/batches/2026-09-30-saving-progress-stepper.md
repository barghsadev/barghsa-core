# Saving fulfillment progress stepper

Canonical work: `07-ui-ux-design.md#T-07.27.01.03` (`ProgressStepper`), saving-fulfillment portion.

The shared progress stepper now draws logical-direction connector lines between completed, current and pending steps, and highlights the current step with reduced-motion-aware animation. The customer saving-order detail page uses it for the five server-provided fulfillment stages. Localized status text, completion dates and handover descriptions remain available, including to assistive technology.

The solar-construction usage in the same task remains open. The current solar request API reports request statuses rather than the specified construction milestones, so this batch does not infer a delivered or installed stage from those statuses.

Validation: shared UI tests (60), all web unit tests, saving customer/staff Chromium journey, root build/typecheck/lint/format, route budgets and generated backlog check.
