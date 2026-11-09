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
