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

Configure direct HTTPS endpoints for server-side payment requests, inquiries and
verification. The HTTP and ZarinPal adapters refuse transport redirects and cap
decoded JSON responses at 10 MiB. A transport failure or an oversized response
leaves the outcome uncertain. Keep the original payment identity for inquiry and
reconciliation. The checkout URL still comes from the validated provider receipt.

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

## Signed callback anomalies

`PaymentCallbackAnomaly` raises a P1 when the signed top-up or chargeback endpoint
detects an invalid signature, a timestamp outside its existing tolerance, or
reuse of a claimed event ID. Recent anomalies are grouped by environment and
database across API replicas. The alert clears five minutes after the last
observed anomaly. A provider retry after a completed event can trigger this
alert while safely receiving the stored outcome.

Use `payment_callback_last_anomaly_timestamp_seconds` on the private API scrape
to distinguish top-up from chargeback and signature failure from stale time or
event replay. Compare the server clock and gateway delivery history. The metric
contains only the fixed endpoint and reason labels and the API server's clock.
Use the protected payment event and ledger records to check whether the
original event settled. Keep uncertain payments in reconciliation and preserve
their original idempotency keys. Browser confirmation retries and recovery of
matching in-progress events follow their normal settlement checks.

## Conflicting payment retries

`PaymentIdempotencyConflict` raises a P1 when the online top-up, bank-receipt
top-up or wallet invoice payment service sees different payment data under a
previously used key. Exact retries follow their original idempotency checks.
A stale invoice amount on the first use of a key still requires a new review.
The private scrape shows only the operation name and the time of detection.

Check the original receipt, ledger and protected audit trail before any
corrective payment. Preserve the original key and existing settlement record.
Use a newly reviewed payment only after the prior outcome is known.
