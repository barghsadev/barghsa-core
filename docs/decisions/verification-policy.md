# Verification policy

The existing verification mode remains the global switch. The versioned
`profile_verification_policy` config adds independent individual/legal requirement
flags, required document types, validity in whole days, staff auto-verification
and elevated document overrides. Defaults retain existing behavior: both profile
types require verification when the global mode requires it, no document list or
expiry is imposed, protected staff creation verifies its new individual profile,
and document overrides are disabled.

The admin page saves a draft without changing runtime policy. Activation requires
recent password step-up and the exact saved policy/revision. Audit and configuration
changes commit together, with current authority checked through commit. Unknown
receipts hold the editor until a fresh read and explicit saved-state reset.

Required documents are staff-classified evidence, not automatic document
recognition. CRM reviewers upload through the existing verified upload path or
submit previously sealed profile-bound evidence. The review seals new evidence,
checks immutable existing evidence and records its document type and key in the
verification audit. One file cannot satisfy multiple required document types.
Overrides require active policy permission, a nonempty reason, both `crm:verify`
and `admin:config:write`, and recent step-up. Revocation and re-verification retain
their existing reason, notification and authorization checks.

Migration `0279` adds nullable `profiles.verified_at`. It does not invent dates for
old approvals or change any existing profile value. New manual approvals and
authorized staff auto-verification stamp this field. Configured validity expires
at the exact deadline measured from this successful verification; unrelated
profile edits do not extend it. Enabling or shortening expiry applies to current
approvals immediately. An approval with no recorded date requires review when
expiry is enabled. The shared commercial-order boundary enforces the requirement
and expiry under the same configuration/profile locks as submission. Existing
orders, contracts, invoices and financial snapshots are not rewritten.

Staff auto-verification is restricted to the protected, audited staff-creation
transaction and applies only to new staff profiles. Turning it off produces a
profile awaiting verification. A customer choosing staff context never receives
identity approval. Automatic external identity verification remains unavailable
until a real provider is configured and verified.

Retain the additive timestamp column and its data on rollback. An older binary
does not enforce the expanded policy. If binary rollback is necessary after an
expanded policy is activated, block new commercial submissions at the ingress until enforcement is restored.
The existing capability maintenance switches can also stop electricity, saving
and solar submission, but do not assume they cover consultation. Do not silently treat an
older binary's successful health check as verification-policy acceptance.
