# Authorization policy

PostgreSQL supplies current account, session, ownership and role authority. The session guard checks expiry, revocation and operating context and loads current staff grants. The endpoint identifies the resource and action, applies its domain capability and checks the object's authorized scope before it returns private data or accepts a command. UI navigation only presents the actions available to the current context. [Session controls](session-lifetime.md).

## Customer profiles

- Use the authenticated account's server-owned active profile preference or the endpoint's explicit profile ID. In either case, authorize that profile using its current owner or active agent membership. Switching profiles changes a preference. The same account must prove authority to use the new selection. [Owner decision on profile context](../decisions/profile-workspace-navigation.md).
- An agent's Manager, Finance and Legal roles contribute additive capabilities within one legal profile. Actual ownership comes from the profile's current owner. Domain operations apply their permission for the requested action and retain additional constraints such as commercial verification or a signature review.
- Endpoints using the agent permission guard must declare a capability on the handler or controller. The guard denies requests when that declaration is missing and gives handler declarations precedence.
- Read and mutate customer orders, invoices, contracts, wallet records, tickets and documents within the authorized profile or account. Apply both the record identifier and authorized scope before returning results or issuing a signed transfer. Keep exact amounts, terms and state transitions inside the domain's authoritative transaction. [Customer setup and delegation](../decisions/customer-setup-and-delegation.md).
- Consultation list and detail reads require related invoices, adjustments and refunds to belong to the request's authorized profile. This check also covers older references that can point to an invoice from a different profile.
- Solar list and detail reads scope the related contract, publication and initial invoice to the request's authorized profile.
- Saving list, detail and change commands use the saving profile to scope the commercial order, invoice and contract. Change review and confirmation apply that scope before locking financial records. Hardware history uses the same profile for linked adjustment invoices.

## Staff capabilities

- Staff sessions use the union of current database role capabilities for Customer Support, CRM and Verification, Finance, Legal and Contracts, Operations and Admin. A matching permission, explicit wildcard grant or current administrator authority is required. Staff account status permits staff context. Each protected operation still checks the required capability.
- Apply resource and assignment scope when the domain requires it. Explicit module-wide document read grants retain their approved scope. Distinguish read, write, approval and override capabilities, and require fresh step-up for designated high-risk actions. [Verification authority](../decisions/verification-policy.md).
- Recheck current session, capability and scope inside the protected decision when concurrent role removal, ownership changes or expiry could invalidate it. Preserve required CSRF proof, audit and idempotency across retries. Keep protected audit records separate from general diagnostics.

Staff role replacement requires the dedicated role capability and recent OTP
proof on the live session. Financial confirmations, refunds, contract decisions
and provider credential changes check their operation-specific capability and
step-up proof. A review can return the authorized consequences before step-up.
The command that changes state checks the proof before applying those effects.
Verification provider configuration writes and circuit-breaker resets also
require fresh step-up. The verification adapter remains a development stub.

## Background and external work

- A worker acts on an authorized durable record with an operation-specific claim or lease. Before publishing a private result, recheck its current ownership or grant and enforce its result scope. Preserve transaction and provider idempotency boundaries when a retry is allowed. [Async jobs](../operations/async-jobs.md).
- The assistant reads published knowledge within the current audience and slot. Its launch scope permits read-only guidance. Session, operating context, publication and output checks determine what an answer can include. [AI inference](../operations/ai-inference.md).
- Signed provider callbacks prove the expected issuer, message and replay boundary independently of customer or staff sessions. Resolve the referenced durable intent before accepting a status or financial change. [Staging payment verification](../operations/staging-payment-sandbox.md).

The model-test worker rechecks the requesting staff grant before calling the
provider. The profile-export worker checks the current owner, active profile
and job lease before collecting data and before publishing the result. Export
downloads and document links check the current session and scope before signing.
The customer and staff application paths share the same profile and capability
rules at those boundaries.
