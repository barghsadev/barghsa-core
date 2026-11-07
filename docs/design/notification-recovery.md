# Notifications and recovery

Show persistent feedback beside the work it describes. Toasts supplement that feedback and never prove permission, a financial outcome or a successful retry.

## Confirmed command feedback

Intercept results after the domain has validated the receipt and checked the captured owner. `useServerMutation` already does this for its consumers. `useCommandFeedback` and `CommandFeedback` use the existing verified success/error state in the remaining forms. Do not infer completion from a global `fetch` interceptor or a successful HTTP status. Malformed receipts and lost financial responses keep their original reconciliation holds.

For an action with a shared confirmation dialog, its receipt handler can return a localized success message after the receipt matches the reviewed command. Returning nothing leaves feedback to the caller. The dialog suppresses feedback for a retired profile and warns when a request was sent but its outcome is unconfirmed. The warning asks the user to check current status; it does not schedule a retry. A recorded refund or approval is described as an update until the actual terminal state is known.

The feedback scope includes account, profile revision, language and the supplied operation. A scope change disarms announcements until the caller clears the old result. Repeated renders do not announce the same occurrence again. Keep private state retirement and current-owner checks in the domain controller as well.

`useToast` supports localized keys or domain-localized strings, all four severities, and a promise helper. Pass a validated operation promise. Its rejection still reaches the caller; it does not retry the operation. Only the latest operation owns the persistent progress notice, and a profile-context dismissal prevents a late result from restoring old content.

The Sonner host loads on demand. It uses semantic severity colors, at most three visible notices, a localized close button and direction-aware swiping. Notices use the topbar’s current bounds, including when an account banner moves it. They fade in at that offset and yield while a dialog or popover is open. Financial dialogs keep their own persistent feedback and focus protocol.

## Inbox and time

Mark-as-read is an optimistic display change. A failed or malformed receipt restores the accepted rows and count and shows a warning. A denial retires private state. Repeated cursors, stale reads and stale write completions cannot replace the current inbox or navigate to a record.

Date groups use calendar days in the saved account time zone, including daylight-saving transitions. Persian weeks begin on Saturday; English weeks begin on Monday. A failed time-zone read leaves notifications available without claiming a saved grouping. The user can retry that read independently. The existing unread-count prefix in background tab titles remains compatible with route and brand title changes.

## Waiting and failure states

Waiting views show the current status, latest update, responsible party, recorded submission time, next action and support route. Use a server-provided response target when available. Otherwise state that a response time is unavailable; never turn a current configuration default into a promised historical deadline.

Verification submission time comes from the immutable onboarding audit entry or the latest matching pending transition notice. Reading a notice does not erase its timestamp. A newer inconsistent transition cannot revive an older onboarding timestamp. Never substitute the profile's mutable `updated_at` value.

Keep loading, empty, failed and denied states distinct. A dependency failure needs an explanation, a responsible team and a usable retry or support route. Route error details contain only a product-defined code and an opaque support reference. Do not display or transmit exception messages, stacks, form values, profile identifiers or provider responses as browser diagnostics. Reporting failure must not prevent recovery.

The auth build excludes customer-only profile and verification imports. Its existing route guard hands off non-authentication URLs before those workspaces can mount. Purchase components remain eager; their pending and error views can load separately. Budget checks still count the full emitted payload and retain the original limits. A Register facade emitted under a hashed manifest key uses the existing unique dynamic-entry selector, `chunk:index`; an ambiguous or missing entry fails the check.
