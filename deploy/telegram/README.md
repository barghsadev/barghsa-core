# External staging Telegram transport

The owner designated `eu.barghsa.com` for Telegram because the staging network
cannot reach Telegram. NGINX relays only this bot's `getMe` and `sendMessage`
requests from the staging IP. It forwards the secret-authenticated webhook to
the existing staging route. Account/profile checks, private-chat validation,
link confirmation, AI audience checks, durable queues and exact message receipts
stay in the application. This host has no database or application worker.

The application uses `CUSTOMER_TELEGRAM_TRANSPORT=external-eu` in protected
staging configuration. Missing transport configuration retains the official
Telegram endpoint. Every other value fails closed. There is no configurable
arbitrary proxy URL. The release notifier remains separate and uses its existing
local protected configuration.

## Host setup

Follow [host access](../../docs/operations/telegram-host.md). Verify SSH trust,
DNS and direct Telegram reachability before changing anything. Install Ubuntu's
`nginx` and `certbot` packages. Create `/var/www/barghsa-acme`, serve that webroot
on port 80 for `eu.barghsa.com`, and obtain a certificate using Certbot's webroot
flow. Keep the renewal timer enabled and install the existing
`deploy/staging/certbot-reload-nginx.sh` renewal hook. Disable Ubuntu's default
site on this dedicated host.

Render `nginx.conf` privately, replacing `__BOT_TOKEN__` with the configured bot
token and `__WEBHOOK_SECRET__` with the existing customer webhook secret. Validate
the token against `^[0-9]+:[A-Za-z0-9_-]{20,}$` and the secret against
`^[A-Za-z0-9_-]{32,256}$` before substitution. Read them from a mode-0600 file or
stdin; never pass them as command arguments. Install the result at
`/etc/nginx/conf.d/barghsa-telegram.conf` with mode 0600. Test with `nginx -t`
before reloading. The root NGINX master reads this configuration before dropping
worker privileges.

TLS verification applies to both upstreams, with depth 3 for staging's valid
cross-signed CA chain. The outbound path is restricted to
the staging IP and the exact bot token and methods. Callback bodies are bounded
to 64 KB, rate limited and authenticated at both relay and application. Request
headers are rebuilt; cookies and arbitrary authorization headers are not relayed.
No upstream retry, caching, path logging or payload logging is enabled. The
application still holds uncertain sends without replay. The health log records
only status, upstream address and timings, without paths, headers or payloads.
Monitor it and durable application receipts; do not turn on URL logging to
diagnose failures.

## Verify before handoff

1. From staging, verify the bot identity through the HTTPS relay. From an
   unrelated client, verify outbound POST access is denied. Verify other bot
   methods and arbitrary paths return 404.
2. Verify invalid callback secrets return 401. With the protected secret, an
   empty callback must return the application's ignored-update receipt. This
   sends no message. Verify the active source/image and transport configuration.
3. Save the current `getWebhookInfo` response privately. Only after both paths
   work, perform the owner-authorized handoff to
   `https://eu.barghsa.com/api/telegram/webhook`, with the same protected webhook
   secret, `allowed_updates=["message"]` and `drop_pending_updates=false`.
   Reconcile an uncertain handoff through `getWebhookInfo` before any retry.
4. Complete a fresh link from a current customer session/profile, confirm the
   private code in that session, and ask a controlled published-knowledge
   question. Verify real private replies, audience isolation, root version and
   exact persisted Telegram receipts. A synthetic callback cannot certify a
   real customer linkage. Group/channel updates must remain ignored.

Changing the transport does not accept a release or authorize production. Keep
the previous webhook until replacement preflight passes. If handoff has already
occurred, inspect pending updates and durable delivery state before restoring an
earlier verified callback. Preserve unknown sends indefinitely for reconciliation.

If private link codes arrive but knowledge answers fail, inspect the durable
question status and test the embedding provider separately. Telegram transport,
embedding access and the model worker have separate failure boundaries. A healthy
worker does not prove provider access. Check management credential expiry before
using the provider console/API to diagnose a missing workspace; expired management
access and a runtime HTTP 404 do not establish the same cause. Keep failed/unknown
delivery history intact and verify the repair before requesting a fresh question.
