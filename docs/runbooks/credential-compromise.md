# Credential compromise

**Incident P0 for an active breach or suspected use of a privileged credential. Security leads with platform operations and the credential owner.** Signals include unusual successful authentication, a leaked token or a provider report of unauthorized use.

1. Page security and open a protected incident. Determine whether the credential is a session, deployment secret, vendor token or encryption key. Record its identifier or fingerprint, affected scope and evidence references.
2. Revoke affected sessions and refresh grants with the existing authorized account/security workflow. For an external credential, disable it with its issuer and follow the protected configuration process for the replacement. Coordinate service account rotation across the replicas that use it. Encryption-key rotation requires the approved re-encryption procedure and a verified recovery copy.
3. Preserve scoped audit and sanitized application evidence and review permitted actions during the exposure window. Avoid replaying uncertain provider actions and escalate any suspected unauthorized financial movement to Finance.
4. Verify the old credential is denied at the correct boundary, the authorized replacement works, and revoked sessions remain invalid. Read back role and account changes and reconcile related provider activity.

Call the primary and credential owner immediately if scope or revocation cannot be verified. Use the approved customer update and preserve the timeline, affected references and follow-up actions. [Security incident procedure](../operations/incident-response.md#security-incidents). [Session controls](../security/session-lifetime.md). [Account recovery](account-recovery.md).
