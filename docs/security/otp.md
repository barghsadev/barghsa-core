# OTP expiry and delivery records

OTP challenges expire after five minutes by default. Administrators can set a lifetime from 60 to 900 seconds. The saved deadline applies to each issued challenge, and the API rechecks it before committing authorization.

The challenge stores a SHA-256 digest. The restricted auth delivery queue temporarily holds the code in an encrypted payload for delivery to its bound contact. As expired, consumed or replaced deliveries become available to the worker, it cancels them and erases the payload. Successful delivery also erases the payload. The inbox receives only the safe delivery notice.

Retain challenge and delivery metadata for receipt correlation and linked account-recovery evidence. Challenge expiry is enforced by the API even when delivery cleanup is delayed.

The console can show a code only when `NODE_ENV=development` and `OTP_CONSOLE=true`. The diagnostic uses the challenge reference. Application logs for issuance and resend use challenge and correlation references.

## Staff invitations

A staff invitation email includes a link with a public invitation reference and a separate one-time activation code. The reference is the SHA-256 digest of the random code. The activation form submits the code in the JSON body with the matching reference. The existing 24-hour expiry, rate limit and atomic single-use activation apply.

The API accepts the new versioned activation code format. The worker cancels queued legacy activation messages that embedded the code in the link and erases their encrypted payload. This preserves existing delivery keys and avoids replaying a previously attempted message with changed content. If an older invitation is still pending, an authorized administrator can issue a fresh one from staff administration. The activation page clears historical fragments before loading browser modules and accepts codes entered through the form.
