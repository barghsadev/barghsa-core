# Customer workflow guidance checklist

Use this checklist when adding or changing a customer-facing order, request, or contract detail view. It implements `03-core-business.md#T-03.90.18`. Review each reachable state, including pending, rejected, failed, cancelled, and complete states; a component's presence alone does not prove the guidance is accurate.

- **Current state:** Does the page name the current persisted state in customer language, with an appropriate localized label?
- **What happened:** Does it show the latest meaningful event or reason, including a rejection or failure reason when the customer may act on it? Is it based on current server data rather than a stale local action?
- **Next action:** Is the next available action specific and linked to a working control when the customer owns it? For a wait, explain what will happen next; for a terminal state, say that no action is required.
- **Responsible party:** Does the owner match the actual permission and state: customer, staff, or no one? Check this again after every transition and reload.
- **Help:** Is support reachable from the same view through the customer ticket route (`/tickets`)? Check keyboard access and both Persian RTL and English layouts.

The shared `WorkflowStatusBanner` provides the five display slots. The owning view supplies truthful state-specific data and action links. Current uses are:

| Workflow | Customer detail view | State-specific action source |
| --- | --- | --- |
| Electricity order | `ElectricityOrderDetailsPage` | Order state, payment, staff-review and contract actions |
| Saving order | `SavingOrderDetailPage` | Fulfillment and customer-change actions |
| Solar request | `SolarRequestDetailPage` | Document, postal and decision actions |
| Consultation | `ConsultationDetailPage` | Information and offer actions |
| Contract | `ContractDetail` | Acceptance and live signature permissions, including preparation and recording |

For a new workflow, add the banner to the customer detail view, then verify representative actionable, waiting, error/rejected, and terminal states in the relevant component tests. For a changed transition, verify the banner's owner and link against the action control rather than repeating the state name as the next action. Staff-only controls do not count as a customer next action.
