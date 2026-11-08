# Notifications and recovery

Show persistent feedback beside the work it describes. Toasts supplement that feedback and never prove permission, a financial outcome or a successful retry.

## Confirmed command feedback

Intercept results after the domain has validated the receipt and checked the captured owner. `useServerMutation` already does this for its consumers. `useCommandFeedback` and `CommandFeedback` use the existing verified success/error state in the remaining forms. Do not infer completion from a global `fetch` interceptor or a successful HTTP status. Malformed receipts and lost financial responses keep their original reconciliation holds.

For an action with a shared confirmation dialog, its receipt handler can return a localized success message after the receipt matches the reviewed command. Returning nothing leaves feedback to the caller. The dialog suppresses feedback for a retired profile and warns when a request was sent but its outcome is unconfirmed. The warning asks the user to check current status; it does not schedule a retry. A recorded refund or approval is described as an update until the actual terminal state is known.

The feedback scope includes account, profile revision, language and the supplied operation. A scope change disarms announcements until the caller clears the old result. Repeated renders do not announce the same occurrence again. Keep private state retirement and current-owner checks in the domain controller as well.

Map public error codes to localized messages and use a safe fallback for unrecognized errors. Do not display raw response text. Keep a reviewed order and its idempotency key for an explicit retry when the input is unchanged.

For customer invoice and wallet bank receipts, announce submission only after the response confirms the reviewed amount and pending state. A lost or malformed acknowledgement leaves the outcome unconfirmed and asks the customer to check current status. A wallet retry of the same reviewed receipt keeps its original idempotency key and attachment. A failed history or balance refresh does not overturn an acknowledged receipt.

The invoice receipt form distinguishes an empty active-profile selection from a failed profile read. A fresh profile is required before upload. If the receipt review times out, the draft and staged attachment remain available for an explicit retry. A review must match the active profile, invoice and captured receipt fields before confirmation can open.

Online wallet returns wait up to 15 seconds for confirmation, including the receipt body. A timeout leaves the payment outcome unknown because settlement may continue on the server. The customer can check the same payment again explicitly. Only a matching receipt in the current wallet view can trigger a balance refresh.

Profile export requests and preparation use the same browser deadline. An explicit retry keeps the original request key or saved export ticket. If a retry of a failed job times out, reload its status before offering another retry. The server may have queued the job even if the browser never received the receipt.

The customer guide allows up to 300 seconds for retrieval, answer generation and delivery, with a 15-second limit between stream reads. Partial text stays labelled unfinished until the final receipt validates the answer and its sources. After a timeout or an in-progress response, an explicit recheck uses the original request ID.

In electricity and saving order discussions, an explicit retry after a transport failure announces the connection retry. Keep the failed page cursor, existing comments and unsent draft. HTTP errors and invalid response bodies retain inline recovery.

`useToast` supports localized keys or domain-localized strings, all four severities, and a promise helper. Pass a validated operation promise. Its rejection still reaches the caller; it does not retry the operation. Only the latest operation owns the persistent progress notice, and a profile-context dismissal prevents a late result from restoring old content.

The Sonner host loads on demand. It uses semantic severity colors, at most three visible notices, a localized close button and direction-aware swiping. Notices appear below the current breadcrumb, onboarding heading or public auth language switch. The topbar supplies the offset on pages without an explicit anchor, including when an account banner moves it. Notices fade in and yield while a dialog or popover is open. Financial dialogs keep their own persistent feedback and focus protocol.

## Inbox and time

Mark-as-read is an optimistic display change. A failed or malformed receipt restores the accepted rows and count and shows a warning. A denial retires private state. Repeated cursors, stale reads and stale write completions cannot replace the current inbox or navigate to a record.

Date groups use calendar days in the saved account time zone, including daylight-saving transitions. Persian weeks begin on Saturday; English weeks begin on Monday. A failed time-zone read leaves notifications available without claiming a saved grouping. The user can retry that read independently. The existing unread-count prefix in background tab titles remains compatible with route and brand title changes.

## Waiting and failure states

Waiting views show the current status, latest update, responsible party, recorded submission time, next action and support route. Use a server-provided response target when available. Otherwise state that a response time is unavailable; never turn a current configuration default into a promised historical deadline.

Verification submission time comes from the immutable onboarding audit entry or the latest matching pending transition notice. Reading a notice does not erase its timestamp. A newer inconsistent transition cannot revive an older onboarding timestamp. Never substitute the profile's mutable `updated_at` value.

Keep loading, empty, failed and denied states distinct. A dependency failure needs an explanation, a responsible team and a usable retry or support route. Route error details contain only a product-defined code and an opaque support reference. Do not display or transmit exception messages, stacks, form values, profile identifiers or provider responses as browser diagnostics. Reporting failure must not prevent recovery.

For account settings, use the query's deadline error to end visible loading even when the request owner discards updates from the aborted transport. An explicit retry renews only the failed settings read. Companion sections keep their confirmed data, and writes in the failed section stay disabled until a fresh read succeeds.

The auth build excludes customer-only profile and verification imports. Its existing route guard hands off non-authentication URLs before those workspaces can mount. Purchase components remain eager; their pending and error views can load separately. Budget checks still count the full emitted payload and retain the original limits. A Register facade emitted under a hashed manifest key uses the existing unique dynamic-entry selector, `chunk:index`; an ambiguous or missing entry fails the check.
