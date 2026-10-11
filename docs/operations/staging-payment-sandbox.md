# Controlled staging payment sandbox

The owner authorized creating missing staging payment configuration. This fixture
uses the existing registered HTTP adapter. It represents synthetic settlements,
not a PSP account or real funds. Production still requires its own merchant
configuration and acceptance evidence.

`deploy/staging/payment-sandbox-compose.yml` runs one process on the private
staging network with loopback port9096. Mount the reviewed source from an immutable
commit using `BARGHSA_PAYMENT_SANDBOX_SOURCE`, and select the existing accepted
Node application image with `BARGHSA_APP_IMAGE`. The staging NGINX configuration
exposes only `/__staging/payment/` through the existing HTTPS origin, with a16KiB
body limit and the existing edge quota. This route is absent from production
configuration.

Store configuration in root-owned0600
`/etc/barghsa/staging/payment-sandbox.env` under the root-only directory:

- `PAYMENT_SANDBOX_ENVIRONMENT=staging`
- A fresh random `PAYMENT_GATEWAY_MERCHANT_ID` identifying this fixture
- Independent random `PAYMENT_GATEWAY_API_KEY`, `PAYMENT_SANDBOX_OPERATOR_KEY`
  and `PAYMENT_GATEWAY_WEBHOOK_SECRET`, each at least32 characters
- `PAYMENT_SANDBOX_LEDGER=/data/ledger.jsonl`

The durable ledger directory is `/var/lib/barghsa/staging-payment-sandbox`.
Give the container's Node UID exclusive write access. Run one process per ledger.
Each request and settlement is appended and fsynced before acknowledgment.
Restart restores saved identities. A corrupt ledger prevents startup; a persistence
failure makes the process unavailable until reconciliation and restart.

The API uses `PAYMENT_GATEWAY_ADAPTER=http`, the fixture merchant/key/secret and
these URLs in its protected staging runtime configuration:

- `PAYMENT_GATEWAY_REQUEST_URL=https://stg.barghsa.com/__staging/payment/request`
- `PAYMENT_GATEWAY_INQUIRY_URL=https://stg.barghsa.com/__staging/payment/inquiry`
- `PAYMENT_GATEWAY_VERIFY_URL=https://stg.barghsa.com/__staging/payment/verify`
- `PAYMENT_GATEWAY_ALLOWED_HOSTS=stg.barghsa.com`
- `PAYMENT_GATEWAY_CALLBACK_URL=https://stg.barghsa.com/api/wallet/top-ups/callback`

Request, inquiry and verification require the provider key and reject browser
Origin/cookie credentials. Exact request replay retains its authority; changed
amount/order/callback returns409. Verification remains unpaid until a protected
operator command settles that exact authority/order/amount.

For an authorized synthetic staging payment only, POST JSON to
`/__staging/payment/settle` with `idempotencyKey`, `orderId`, `authority` and
numeric `amount`, using the separate operator bearer token. The response supplies
the exact signed callback body, destination and headers. It does not send the
callback automatically. Use the supplied bytes without reserialization.
Repeated settlement retains the same callback event ID and body; the application
retains its normal timestamp, HMAC, merchant, amount, provenance and replay checks.
Read-only browser visits never settle or credit a wallet.

Record live HTTPS request/inquiry/verification and actual application callback
receipts separately in the board. A fixture test or a signed envelope is not a
confirmed wallet credit. Preserve uncertain outcomes for reconciliation.
