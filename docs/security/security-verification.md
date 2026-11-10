# Security verification scope

Run the independent pre-launch penetration test against the immutable staging
candidate. Repeat the review after material changes to authentication,
authorization or payments. Use synthetic customer profiles, staff accounts
with different grants, owned and foreign resource IDs, sealed fixture files,
and isolated payment and messaging adapters. Record the tested commit and
configuration, reproduction steps, observed authority and effects, and the
cleanup of test fixtures. Store detailed evidence in the restricted review
workspace.

## Targeted regression cases

| Area                            | Cases                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSRF and CORS                   | Exercise session, public authentication and refresh proofs. Try missing, expired, rotated and foreign proof, cross-site submission, and credentialed preflights from trusted and untrusted origins.                              |
| Authentication, session and MFA | Verify credential rotation on login, step-up and privilege changes. Race refresh reuse with rotation and revoke the affected token family. Check that expiry, idle limits, and recovery preserve the expected session authority. |
| BOLA and IDOR                   | Request known foreign invoice, order, contract and wallet IDs from an unrelated profile. Repeat relevant operations after ownership or agent authority changes. Check the resource response and absence of unauthorized changes. |
| Rate limits                     | Use trusted and untrusted forwarding hops, forged address headers, concurrent hits and profile-scoped quotas. Verify localized responses, retry timing and separation of unrelated actions.                                      |
| Upload abuse                    | Submit malformed or foreign business links, invalid upload categories and oversized, mismatched or forged bytes. Check the reservation, sealing and cleanup records alongside the response.                                      |
| Open redirects                  | Supply external and malformed navigation links through notifications and payment returns. Verify that navigation follows an allowed destination and that browser payment-return parameters cannot settle a payment.              |
| SSRF                            | Use loopback, private and metadata addresses, a hostname with private DNS answers, and a redirect to an internal destination. Check the resolved connection target and provider boundary.                                        |
| Webhooks and payment integrity  | Send valid and invalid signatures, old timestamps, merchant and amount mismatches, reused event IDs and concurrent deliveries. Verify provider status independently and check the ledger for a single legitimate effect.         |

The repository regression fixtures cover these cases across the API, shared
validation, and the native PostgreSQL and object-storage boundaries. See the
source-bound test receipts on the task board. [Task board](../../kanban/BOARD.md).

The compiled HTTP subset runs the application with disposable databases. It
exercises session and origin controls, forwarded-address limits, direct UUID
substitution, the SMTP connection guard, and payment-return navigation.
Follow the CI fixture setup when running it locally. [Test databases](../development/ci.md#backend-test-databases).

```sh
rtk proxy pnpm --filter @barghsa/api exec vitest run \
  src/session/preauth-csrf-http.integration.test.ts \
  src/session/session-http.integration.test.ts \
  src/auth/login-rate-http.integration.test.ts \
  src/auth/proxy-rate-http.integration.test.ts \
  src/orders/order-access-http.integration.test.ts \
  src/provider-config/provider-test-http.integration.test.ts \
  src/wallet/online-topup-http.integration.test.ts
```

## Original files and previews

Document, template and receipt originals use 300-second private signed URLs
with a signed attachment disposition. The original filename stays out of the
URL. Document viewers and the staff invoice and wallet receipt queues display
only bounded PNG derivatives of sealed files. The receipt preview requests
require the current finance grant and return private, no-store responses.
When the renderer cannot produce a PNG, the original remains available to
authorized reviewers as a download. Branding and avatar URLs still serve the
verified raster image assets selected for display.

Upload reservations record the original name as metadata. The object key uses
the server-selected category and a random UUID, with a final alphanumeric
extension when present. A path-shaped suffix stays in the metadata alone.

For constrained categories, the final extension selects the eligible MIME
types. Verification compares them with stored bytes, so a name such as
`report.exe.pdf` still requires PDF bytes. Office detection runs in a worker
with bounded concurrency and a deadline. DOCX template and knowledge-base
extraction cap the entry count and expanded text. Generic ZIP uploads remain
opaque storage objects.

## Authorization audit

In the staff workspace, open **Settings → Security → Authorization audit**
with a current administrator or wildcard grant. The dashboard reads at most
50 records at a time from the append-only `authorization_denials` table. It
shows the actor, operation, resource template, reason, time and correlation ID
when present. Authenticated HTTP denials and opaque resource misses use the
same public response as before. The queued AI model test records a denial
when the submitting actor loses authority before execution.

The audit uses the matched route template. It excludes resource identifiers
from the URL, query values, bodies, cookies and provider credentials. Opaque
misses are recorded with the same reason whether the resource is missing or
outside the actor's authority. The separate table preserves business audit
and rollback semantics. A failed write leaves the original denial in effect
and emits `authorization.denial.persistence_failed` with the same safe fields
for operations to investigate. Check that event alongside the API and worker
logs after a database incident.

## Live candidate review

- Exercise login, logout, account recovery, MFA step-up and context changes
  across customer, agent and staff sessions. Include relevant legacy sessions.
- Check credentialed browser requests, response headers, CSP reports and
  enforcement on customer and staff pages in the release browsers.
- Attempt unauthorized reads and writes across profiles, staff grants and
  workflow states. Verify rate limits and proxy trust at the staging edge.
- Exercise storage upload, preview, download, scanning, replacement and
  retention through the configured private provider boundary.
- Verify signed webhook ingress and read-only browser payment returns. Follow
  controlled payments, refunds and reconciliation through provider and ledger
  receipts using synthetic money.
- Probe prompt injection, cross-profile retrieval, unpublished knowledge,
  output handling and channel-specific authorization in the owner-approved
  read-only assistant. Include tool discovery and attempted writes in that
  scope so the reviewer can verify the launch boundary.

Treat critical and high findings with a credible production path as release
blockers. Keep any permitted risk disposition tied to its owner, evidence,
expiry and retest. Preserve the separate staging DAST and independent review
receipts on the release board. [Supply-chain triage](supply-chain.md).

## Authenticated staging scan

Run the pinned OWASP ZAP image against the exact staging release using a
dedicated synthetic customer and an empty individual profile. Use a short-lived
session with no staff grant, linked contacts or refresh token. Save the fixture
as a runner-owned `0600` JSON file containing `session`, `user_id`, `username`
and `profile_id`. Use a `barghsa-dast-…@example.test` username. Keep the fixture
in protected temporary storage and revoke the session and disable the synthetic
account in cleanup.

```sh
rtk proxy python3 deploy/staging/authenticated-dast.py \
  --commit "$STAGING_RELEASE_SHA" \
  --fixture "$PROTECTED_DAST_FIXTURE" \
  --report "$PROTECTED_DAST_REPORT"
```

The runner checks staging metadata over verified TLS before and after the
scan. It validates the anonymous denial, exact customer identity and dedicated
profile through ZAP. The remaining GET probes cover electricity, saving, solar,
consultation and an opaque order miss. Redirect following is disabled. The
scanner runs in silent mode with a temporary loopback control port and removes
its container on exit. The report includes the pinned image, live SHA, probe
statuses and alert IDs, risks and counts. Keep active fuzzing in a disposable
rehearsal environment with synthetic data. [ZAP API](https://www.zaproxy.org/docs/api/), [ZAP command line](https://www.zaproxy.org/docs/desktop/cmdline/).

Exit `1` records a high-risk alert requiring review and blocks this check. Exit
`2` means the fixture, scan, deployment identity or report failed verification.
Review medium findings and record their disposition with the exact candidate
receipt. Run this check again after the final candidate is available.

The first staging rehearsal found two low-risk rules across the API reads.
The live edge omitted HSTS and forwarded `X-Powered-By: Express`. The API
disables the framework header at startup. Check the header through the live
candidate's ingress and keep HSTS activation tied to the TLS and subdomain
review. [HSTS rule](https://www.zaproxy.org/docs/alerts/10035/), [Framework header rule](https://www.zaproxy.org/docs/alerts/10037/).
