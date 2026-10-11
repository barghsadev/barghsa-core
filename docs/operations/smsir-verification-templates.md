# SMS.ir profile verification templates

The owner deferred provider provisioning and live SMS delivery on 11 October 2026 so v0.3.0 staging can proceed. Actual live delivery remains a production-launch prerequisite in the board. Local tests and rejected provider requests do not certify delivery.

Create two SMS.ir templates with one parameter named `MESSAGE`:

Persian:

```text
برقسا
#MESSAGE#
```

English:

```text
Barghsa
#MESSAGE#
```

After approval, configure `profile.verification_status` mappings in the protected SMS provider configuration. For locale `fa`, map `messageFa` to `MESSAGE`; for locale `en`, map `messageEn` to `MESSAGE`. Enter the numeric template ID returned by SMS.ir. The parameter name is uppercase and contains no `#` characters in the mapping.

These message fields contain the profile's verification result, reason and corrective steps. Confirm the provider accepts their full length; do not truncate required guidance or reuse an OTP template. Store credentials privately, never in this document.

For events without a provider mapping, the sender can render the published local SMS body and send direct text using the configured line. Configured mappings take precedence. There is no fallback to a second send after a failed or uncertain provider request. Delivery retains recipient/access/preferences checks, an immutable payload, rate limits and durable receipts.

Both owner-authorized direct-send probes from `3000499605` and `30002108008345` were rejected with HTTP 400, status 123, "خط ارسال‌کننده نیاز به فعال‌سازی دارد." Neither request was accepted. Listing the lines did not establish direct-send activation. Do not resend until provisioning changes.

After provisioning, test each language only to an authorized verified destination. Verify actual provider receipts and delivery reports and record them in the board's operational launch gate. Provisioning does not authorize historical backfill or blind retries of unknown outcomes.
