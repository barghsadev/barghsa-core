# Wizard drafts and consent

All service wizards and onboarding use the shared step, validation and review components. A visible step is validated before advancing, while final submission validates the complete form. Review sections return to the relevant input panel through explicit edit actions. Financial amounts come from the server review snapshot.

The UI requirements describe logical field groups. Existing forms keep their validated panel boundaries. Saving has separate agreement and final financial-review panels; onboarding separates identity from address details. These panels retain every required field and confirmation. Solar keeps its four-stage intake. Electricity keeps separate simple and advanced five-stage flows.

Server drafts are private progress, not submitted business orders. A successful save records progress only. It does not create a contract, invoice, payment, verification decision or consent. Drafts remain bound to their owner and active profile, with versioned receipts where applicable. An unconfirmed save cannot authorize departure or advancement.

The shared retention setting defaults to seven days and accepts integer values from 1 to 365. The current admin endpoint is `/api/admin/config/wizard-draft-ttl`; the historical `electricity.order_draft_ttl_days` key and compatibility endpoint remain. The setting applies to onboarding, electricity, saving and solar drafts. Invalid stored settings fail closed. Expiry clears stale private progress through the audited workflow and preserves profile, version and submitted business history.

Restoring a draft does not restore agreement or equipment-confirmation consent. The customer reviews and confirms the current terms again. Changed plan, agreement, quantities, address or price invalidates an older financial review. Submission captures the reviewed request and retry key; an uncertain result retains that request until its outcome can be established.

Only the safe step number belongs in the public URL. Draft fields, bill identifiers, addresses and agreement decisions stay out of navigation parameters. A deep link cannot skip the saved and validated step ceiling. Browser history and page reload preserve permitted progress without manufacturing consent.

Departure protection distinguishes staying, confirming a save before leaving, and leaving with unsaved edits. Electricity also offers an explicit owner-only discard of saved private progress. An unfinished address is not reported as saved. Pending validation, saving or final submission keeps departure guarded, and mismatched receipts cannot dismiss the dialog.
