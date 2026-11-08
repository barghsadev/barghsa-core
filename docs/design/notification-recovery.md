# Notifications and recovery

Show persistent feedback beside the work it describes. Toasts supplement that feedback and never prove permission, a financial outcome or a successful retry.

## Confirmed command feedback

Intercept results after the domain has validated the receipt and checked the captured owner. `useServerMutation` already does this for its consumers. `useCommandFeedback` and `CommandFeedback` use the existing verified success/error state in the remaining forms. Do not infer completion from a global `fetch` interceptor or a successful HTTP status. Malformed receipts and lost financial responses keep their original reconciliation holds.

For an action with a shared confirmation dialog, its receipt handler can return a localized success message after the receipt matches the reviewed command. Returning nothing leaves feedback to the caller. The dialog suppresses feedback for a retired profile and warns when a request was sent but its outcome is unconfirmed. The warning asks the user to check current status; it does not schedule a retry. A recorded refund or approval is described as an update until the actual terminal state is known.

The feedback scope includes account, profile revision, language and the supplied operation. A scope change disarms announcements until the caller clears the old result. Repeated renders do not announce the same occurrence again. Keep private state retirement and current-owner checks in the domain controller as well.

Map public error codes to localized messages and use a safe fallback for unrecognized errors. Do not display raw response text. Keep a reviewed order and its idempotency key for an explicit retry when the input is unchanged.

Simple and advanced electricity, saving and solar submissions allow up to 15 seconds for a response, including its body. A timeout or invalid acknowledgement freezes the reviewed body and key in the current checkout. Retry sends those exact bytes with the current CSRF token. A rejected retry keeps the outcome unconfirmed. A confirmed receipt opens the saved order or request. Check history before starting a new submission after leaving an unconfirmed checkout.

For customer invoice and wallet bank receipts, announce submission only after the response confirms the reviewed amount and pending state. A lost or malformed acknowledgement leaves the outcome unconfirmed and asks the customer to check current status. A wallet retry of the same reviewed receipt keeps its original idempotency key and attachment. A failed history or balance refresh does not overturn an acknowledged receipt.

The invoice receipt form distinguishes an empty active-profile selection from a failed profile read. A fresh profile is required before upload. If the receipt review times out, the draft and staged attachment remain available for an explicit retry. A review must match the active profile, invoice and captured receipt fields before confirmation can open.

Online wallet returns wait up to 15 seconds for confirmation, including the receipt body. A timeout leaves the payment outcome unknown because settlement may continue on the server. The customer can check the same payment again explicitly. Only a matching receipt in the current wallet view can trigger a balance refresh.

Profile export requests and preparation use the same browser deadline. An explicit retry keeps the original request key or saved export ticket. If a retry of a failed job times out, reload its status before offering another retry. The server may have queued the job even if the browser never received the receipt.

Conversation identity keeps the draft while it uploads a photo for up to 30 seconds or waits up to 15 seconds for the save response, including its body. If a save cannot be confirmed, the editor offers a fresh read. A matching saved revision completes the attempt. A different saved state leaves the draft available for review and a new explicit save.

The customer guide allows up to 300 seconds for retrieval, answer generation and delivery, with a 15-second limit between stream reads. Partial text stays labelled unfinished until the final receipt validates the answer and its sources. After a timeout or an in-progress response, an explicit recheck uses the original request ID.

The public and staff question forms allow up to 300 seconds for the response, including its body. A timeout keeps the question in the field and releases the send control. Sending it again takes an explicit action. A response from a timed-out request or an obsolete workspace cannot replace the current answer.

Consultation intake and replies allow up to 15 seconds for a response, including its body. A timeout leaves the outcome unconfirmed. Intake allows an explicit retry of the original product and submission key. A reply remains locked until a fresh request history confirms the captured information. A late acknowledgement cannot substitute for that history check.

Consultation offer preview and decision responses have the same deadline. An unconfirmed decision closes its review and refreshes the saved request. While the same offer remains pending, only the same decision can be reviewed again. Each new review requires fresh confirmation. Open invoice payment only after a receipt confirms the reviewed request, offer and invoice.

In electricity and saving order discussions, an explicit retry after a transport failure announces the connection retry. Keep the failed page cursor, existing comments and unsent draft. HTTP errors and invalid response bodies retain inline recovery.

`useToast` supports localized keys or domain-localized strings, all four severities, and a promise helper. Pass a validated operation promise. Its rejection still reaches the caller; it does not retry the operation. Only the latest operation owns the persistent progress notice, and a profile-context dismissal prevents a late result from restoring old content.

The Sonner host loads on demand. It uses semantic severity colors, at most three visible notices, a localized close button and direction-aware swiping. An anchor in the main content takes precedence over the breadcrumb. The affected order pages use their introductory header so notices clear the heading and return link. Once saving checkout shows its wizard, notices start below the progress steps. On narrow screens, the saving steps use two columns to leave room for the notice. Onboarding and public auth use their own anchors. The topbar supplies the offset on pages without an explicit anchor, including when an account banner moves it. Notices fade in and yield while a dialog or popover is open. Financial dialogs keep their own persistent feedback and focus protocol.

## Inbox and time

Mark-as-read is an optimistic display change. A failed or malformed receipt restores the accepted rows and count and shows a warning. A denial retires private state. Repeated cursors, stale reads and stale write completions cannot replace the current inbox or navigate to a record.

Date groups use calendar days in the saved account time zone, including daylight-saving transitions. Persian weeks begin on Saturday; English weeks begin on Monday. A failed time-zone read leaves notifications available without claiming a saved grouping. The user can retry that read independently. The existing unread-count prefix in background tab titles remains compatible with route and brand title changes.

## Waiting and failure states

Waiting views show the current status, latest update, responsible party, recorded submission time, next action and support route. Use a server-provided response target when available. Otherwise state that a response time is unavailable; never turn a current configuration default into a promised historical deadline.

Verification submission time comes from the immutable onboarding audit entry or the latest matching pending transition notice. Reading a notice does not erase its timestamp. A newer inconsistent transition cannot revive an older onboarding timestamp. Never substitute the profile's mutable `updated_at` value.

Keep loading, empty, failed and denied states distinct. A dependency failure needs an explanation, a responsible team and a usable retry or support route. Route error details contain only a product-defined code and an opaque support reference. Do not display or transmit exception messages, stacks, form values, profile identifiers or provider responses as browser diagnostics. Reporting failure must not prevent recovery.

The main error boundary sends one same-origin report per displayed failure. If the detailed recovery UI fails to load, the emergency path loads the reporter separately. Signed-in requests carry the session CSRF token. The API applies the origin check and a 1 KiB body limit before forwarding the fixed code and reference to Sentry. The receiver has three seconds to acknowledge the matching event ID. Retry and reload stay usable if the reporting module or endpoint is unavailable.

Set `ROUTE_ERROR_SENTRY_DSN` in the protected API runtime configuration. Use the staging project's HTTPS DSN for staging. Verify a controlled staging route failure by finding its matching reference in Sentry and recording the provider event ID with the candidate commit. Use the existing support reference and avoid copying any unrelated event data.

For account settings, use the query's deadline error to end visible loading even when the request owner discards updates from the aborted transport. An explicit retry renews only the failed settings read. Companion sections keep their confirmed data, and writes in the failed section stay disabled until a fresh read succeeds.

Username, contact and Telegram linking commands wait up to 15 seconds for an acknowledgement, including the response body. An unconfirmed command requires a fresh account or link-status check before further writes. No code or command is resent automatically.

Timezone, notification and marketing saves use the same response deadline. A timed-out save keeps its choices and asks for a fresh settings read. Only a matching saved value completes the pending save.

The shared confirmation dialog uses the same deadline for staff electricity decisions and price adjustments, saving order decisions, fulfillment stages and hardware amendments and cancellations, solar postal tracking, construction milestones and contract issuance, and consultation fee and paid resolution actions. Contract change requests, signature requests and signature recording also use the deadline. These workflows track verification separately from business dispatch. A step-up refusal or a stalled verification can leave the draft available for a new review without an unconfirmed write. If the write outcome is unknown, the workflow retains its reviewed command and idempotency key. Solar construction retains its original operation ID. An explicit retry requires the applicable confirmation and matching receipt.

Customer electricity cancellation and quantity-increase writes also bound response headers and body. An unknown cancellation keeps the reviewed terms and key. A fresh order read may show that the order is already cancelled. If the same version is still eligible, the customer must confirm the same reviewed cancellation again before sending it with the original key. Quantity requests and amendment signatures use their existing exact retry and current-scope checks.

Private simple and advanced electricity drafts use guarded reads, saves and discards. The API compares the captured revision under the current account lock. An unknown reply keeps the draft and waits for a fresh read. Matching saved progress or confirmed absence can resolve the attempt. An unchanged revision allows an explicit retry of the captured command. A different revision with different data asks the customer to reload saved progress. Discard retry requires a new typed confirmation.

The revision record retains only ownership and version metadata. Discard, expiry and submission still delete the draft contents. Old API routes keep their response shapes and advance revisions through the database trigger. The guarded routes are separate so an older server cannot silently accept a conditional write as an unconditional one.

Solar document submission waits up to 15 seconds for a receipt bound to the request and submission key. An unconfirmed reply holds the user's acknowledgement and allows an explicit retry with the same key. The API checks current ownership before releasing a receipt and records the first successful submission, audit entry and notification in one transaction. Replaying the receipt leaves later staff decisions and newly uploaded files alone. A confirmed receipt refreshes the current request so a later staff decision still appears on screen.

Customer and staff ticket commands wait up to 15 seconds for response headers and the receipt body. An unconfirmed reply keeps the captured text, ordered attachment references and submission key. Explicit retry uses the same payload with the current CSRF token. A scope change or loss of authority cancels the transport and suppresses obsolete replies.

Shared verified attachments use a 15-second deadline for each reservation, verification and record acknowledgement. The object transfer uses the signed URL's lifetime, up to 15 minutes, to allow slow links. A stalled stage ends preparation and leaves the caller's draft available. A late reply cannot start the next stage. The bank-receipt form also cancels attachment preparation when its owner changes.

Staff invoice and wallet receipt decisions also use the 15-second deadline. A stalled password verification leaves the decision unsent. An unknown write outcome clears the captured review and reloads the current receipt before staff can review and submit another decision.

Onboarding start, profile completion and dashboard-profile selection use the same deadline. After an unconfirmed start, Retry checks for an active setup before creation becomes available. Profile completion can retry the same owned profile explicitly. An unconfirmed dashboard selection keeps the reviewed choice for exact retry and offers a fresh journey read. When that read confirms completion, opening the dashboard honors the currently active profile without writing another choice.

Terms draft saves, publication and discard use the same response deadline. An unknown result keeps local draft text, retires the old publication preview and disables writes until version history is read again. Revision checks and explicit publication or discard confirmation still apply to a new attempt.

Notification template saves, publication, withdrawal, deletion and test sends use the same deadline, including commands confirmed by password. An unconfirmed command blocks further template writes until a fresh catalogue read succeeds. A draft also needs an explicit reset. Refreshing retires the old publication review and sends no command. An unconfirmed test asks staff to check the destination before sending again.

Delivery-window saves keep the minute-precision draft after an unknown reply. Reset requires a successful settings read started after recovery became necessary. A refresh during an outstanding write cannot satisfy that requirement. Dead-letter actions use the same response deadline and send uncertain results to the existing review without replaying the action.

Single and bulk failed-job retries and resolutions use the same deadline. After an unknown reply, the existing outcome review reads each selected job by ID. Returning from that review clears the selection and requires a fresh queue before another command.

Staff team creation, editing, deletion and assignment-rule writes use the same response deadline. After an unconfirmed write, only a successful read of the affected resource started after the failure can retire the confirmation. A proposal whose saved basis has changed needs an explicit reset. If a creation's name already appears in the refreshed team list, the local draft stays locked until reset. These recovery reads never repeat the write.

Staff directory creation, role changes, activation resends and disabling require a matching acknowledgement. Activation resends confirm queueing. A missing or invalid receipt closes the review and requires a new permission read and, where permitted, a new directory read before another command. Recovery does not reconstruct a one-time password or claim a message was queued. Staff creation continues to rely on the server's unique username check, including when the operator cannot view the directory.

CRM verification correction creation and review use bounded acknowledgements. Creation keeps the reviewed input, verified evidence keys and submission key after an unknown result. A fresh profile read and explicit confirmation are required before retrying it. The server rechecks staff authority and step-up before returning the original creation receipt, including after a reviewer finishes the case. Reviewer decisions wait for fresh queue and case reads before a new confirmation. Losing the creation scope cancels evidence upload.

Customer contact corrections keep the exact reviewed note when a write reply times out or fails receipt validation. Refreshing the open queue permits another explicit confirmation only when the same correction is still open. Staff can check completed history or discard their local note. A fresh read that denies authority clears the local note and hides private rows. Completing the correction leaves email suppression in place.

Default invoice due-period changes wait up to 15 seconds for the acknowledgement. An unknown outcome leaves the draft in place and blocks writes until a fresh settings read succeeds. Manual issuance and invoice corrections use the same deadline for their acknowledgement and for password verification. A timed-out verification leaves the invoice command unsent. An unknown write keeps the reviewed amount, review hash and idempotency key for an explicit retry.

Single-invoice deadline overrides use the same acknowledgement deadline and require a fresh invoice read after an unknown outcome. Reminder toggles keep confirmed changes to other cells and require a fresh, complete matrix after a lost or invalid receipt. A settings reload sends no toggle command. If password verification times out, the captured reminder changes remain queued for a new explicit verification.

Verification-mode draft saves use the same response deadline. An unknown result keeps the selected mode and blocks both saving and activation. Verification and service-workflow settings require a successful read started after the unknown result before staff can reset to the saved version. Activation still requires its own version check and password confirmation.

Profile and saved-address commands and address creation during saving intake wait up to 15 seconds for write headers and receipt parsing. A keyed command can retry its captured JSON with the current CSRF token. Profile switches and default changes, address deletion, and setting the main address instead check the current owned data after an unknown result. A projected acknowledgement that still needs confirmation also proceeds by read alone. Losing the command scope cancels its write transport.

Saving intake retries a failed profile and plan load together. A failed address load retries the address list for the current profile and preserves the draft. The wizard cannot use an unresolved address. An empty plan catalogue needs no private draft or address read, and an empty address list still allows creating an address.

Team invitation sends and recipient actions use the same deadline. An unknown send keeps the draft and refreshes the team. Only a pending row with the same normalized recipient, role and message confirms a matching invitation. A failed refresh leaves sending disabled. A recipient decision or profile switch needs its matching receipt, and a failed attempt waits for a fresh invitations read before another action.

Workspace mode changes, theme saves and terms acceptance wait up to 15 seconds for their response and receipt. An unconfirmed mode change offers a fresh workspace entry through the normal session guard. An unconfirmed theme save keeps the displayed theme until the server preference is read again. An unconfirmed terms decision offers a fresh consent check and loads the current terms if consent is still required. These checks do not replay the writes.

The workspace mode switch loads when the account menu first opens and stays mounted for the current workspace. The terms acceptance request code loads when the user accepts. Each interaction has a separate budget, and the initial route budgets count all eager shell code.

The auth build excludes customer-only profile and verification imports. Its existing route guard hands off non-authentication URLs before those workspaces can mount. Purchase components remain eager; their pending and error views can load separately. Budget checks still count the full emitted payload and retain the original limits. A Register facade emitted under a hashed manifest key uses the existing unique dynamic-entry selector, `chunk:index`; an ambiguous or missing entry fails the check.

Email and SMS provider changes wait up to 15 seconds for the response and receipt. After an unconfirmed save or lifecycle change, refresh the provider list and review its saved state before acting again. An unconfirmed test may still send the message. Check the verified recipient as well as the saved provider state before authorizing another test. The recovery prompt belongs to the open provider panel. If you leave it, check the saved state and the recipient when you return.

Personal and company onboarding draft saves and final submissions allow up to 15 seconds for response headers and the receipt. A stalled draft save keeps the edits and the original version check. After an unconfirmed submission, check the saved profile before submitting again. If the profile was already saved, the check opens that record. An unchanged draft can be submitted again after review. A newer draft requires reloading its saved details.

Staff reconciliation confirmations allow up to 15 seconds for the response and receipt. After an unconfirmed investigation, resolution or closure, the page keeps the reviewed note and checks the exact exception from the server. Review the saved status and note before confirming another action.

The shared confirmation dialog allows 15 seconds for password verification and for commands whose callers handle an unconfirmed result. A stalled password check leaves the command unsent. A command deadline includes the response body and sends an unknown outcome to the caller’s existing recovery. AI model connection tests keep their worker allowance. Document template version publication allows 300 seconds for uploading, extracting and storing the reviewed files.

Wallet invoice payment keeps the reviewed amount, financial review hash and request key after a response timeout. An explicit retry of that payment asks for the original receipt and still requires the financial confirmation. Invoice refund decisions, contract refund decisions and dual approvals require a fresh read after an unconfirmed result. Staff keep their local draft and must review and confirm any action that the saved state still allows. The fresh read does not repeat the command.

An unconfirmed refund or lost-contact case creation keeps its reviewed command when staff close the confirmation. Staff can review the same request again within the current workspace. The refund amount, review hash and key stay bound to the invoice. Lost-contact creation reuses the verified evidence keys and request key, and the server rechecks staff authority before returning the original case receipt. For an existing case, an unconfirmed decision requires a fresh case read. A code send also checks the challenge ID from the reviewed case so a stale command cannot replace a newer code.

Saving and solar detail pages validate the response before showing the record or its action links. A partial response or malformed history stays on the detail page and offers a fresh read. Solar progress must match both the request and its profile. Older records can omit optional history and progress.

Retention policy saves require an acknowledgement with the reviewed record type, duration, hold flag and legal note, plus a new version ID. After an unconfirmed save, check the current version before submitting again. A failed read keeps the draft locked. A fresh read of the same version preserves the draft for a new review. A newer version reloads the form from the saved policy.

Document transitions and inline removal wait up to 15 seconds for the acknowledgement. After an unconfirmed result, check the current document before reviewing another action. A matching unchanged record allows an explicit retry with the original key. Inline removal withdraws the affected file links and locks removal until that read or a newer list result settles the displayed record.

Customer cancellation requests, staff rejection of those requests, and staff cancellation or electricity rejection decisions wait up to 15 seconds for an acknowledgement. An uncertain result keeps the reviewed values and key. A fresh read is required before another confirmation. When that read shows the captured intent was executed, the contract and refund status refresh without sending another execution. An unchanged, eligible intent can be explicitly retried with its original key.

Contract submission, publication, amendment publication and customer acceptance require a receipt for the reviewed contract, profile and version. If the reply is unconfirmed, check the current contract before confirming again. A recorded transition refreshes the view without repeating the write. An eligible staff retry keeps its key. A customer retry requires a fresh financial review and uses the original key only when the review hash still matches.

The shared configuration editors wait up to 15 seconds for a write acknowledgement. An uncertain result keeps the reviewed draft and blocks further confirmation until a successful read starts after that result. A failed refresh keeps the lock. A fresh result retires the old confirmation and applies the editor’s existing draft rules if the saved configuration changed. A refresh never repeats the write.
