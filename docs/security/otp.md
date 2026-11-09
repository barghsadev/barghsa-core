# OTP expiry and delivery records

OTP challenges expire after five minutes by default. Administrators can set a lifetime from 60 to 900 seconds. The saved deadline applies to each issued challenge, and the API rechecks it before committing authorization.

The challenge stores a SHA-256 digest. The restricted auth delivery queue temporarily holds the code in an encrypted payload for delivery to its bound contact. As expired, consumed or replaced deliveries become available to the worker, it cancels them and erases the payload. Successful delivery also erases the payload. The inbox receives only the safe delivery notice.

Retain challenge and delivery metadata for receipt correlation and linked account-recovery evidence. Challenge expiry is enforced by the API even when delivery cleanup is delayed.
