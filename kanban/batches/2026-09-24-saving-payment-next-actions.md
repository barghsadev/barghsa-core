# Saving order payment next actions

Canonical scope: `03-core-business.md#T-03.09.04.03` and `03-core-business.md#T-03.09.04.04`.

The saving order list and detail shared a next-action rule that checked the nonexistent invoice state `PartiallyPaid`. A saving invoice with a confirmed partial payment actually enters `PartiallyFunded`, so the customer could see fulfillment progress instead of the remaining payment action. The shared rule now links that state to the exact invoice. It no longer invites payment of a `Draft` invoice; an approved order with no issued invoice explains that staff are preparing it. Contract acceptance remains the first customer action when still required.

Validation: the saving customer/staff browser journey passes in all five projects, including the partially funded list and detail handoff. The next-action unit suite, web and i18n typechecks, changed-file lint and formatting, and the canonical backlog check pass locally.
