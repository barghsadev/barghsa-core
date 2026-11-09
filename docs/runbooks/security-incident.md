# Security incident response

Security coordinates evidence and credential response. Platform operations owns isolation and recovery. Finance owns reconciliation and clearance of affected money movement. The incident owner approves customer communications. Use the protected incident record and on-call roster. [Incident severities and routing](../operations/incident-response.md).

## Detect and establish scope

1. Open a protected record with the UTC detection time, environment, candidate SHA or active image IDs, affected capability, and initial severity. Record correlation IDs, audit references, provider receipt references and responsible owners.
2. Correlate the signal against authoritative state. Examples include an unexpected role grant, forged callback, anomalous provider send, foreign document access, or divergence between the ledger and its obligations. Page the primary immediately for active compromise or suspected unauthorized financial movement. [Threat model](../threat-model.md). [Payment and wallet mismatch](payment-wallet-mismatch.md).
3. Record the exposure window, affected accounts or profiles, credential types, and which details are confirmed. Preserve the relevant audit and configuration history, protected logs, artifact hashes and collector names. Keep raw customer data and credential material in restricted evidence storage.

## Contain and eradicate

1. Limit the affected capability with the documented, authorized controls. Block the compromised route, credential, or worker identity while preserving unrelated journeys and access to records needed for recovery. Hold affected financial writes and uncertain provider attempts until Finance reconciles the authoritative evidence. [Capability rollback](bad-deployment.md#feature-rollback). [Provider delivery reconciliation](../operations/notification-delivery-recovery.md).
2. Use the revocation procedure below for affected credentials. Remove the exploit path or unsafe configuration using a reviewed change. Rebuild from the verified source and preserve evidence for the rejected revision, configuration or credential identifier.
3. Inspect the affected stores for altered grants, configuration, documents, obligations and durable sends. Preserve original history and record corrections through the authorized business procedure. Validate the fix against the abuse path and the affected callers before restoring traffic.

## Revoke and rotate credentials

| Credential                          | Authorized action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Verification                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application and deployment API keys | Revoke the affected key at its issuer or the owning service. Issue a scoped replacement and apply it through protected configuration for each consumer. Rotate or remove unused replicas and stale configuration references.                                                                                                                                                                                                                                                                                                  | Check denial of the old key and the required calls with the replacement. Record key identifiers, version references, time and affected consumers.                                                                                                                                                                 |
| Provider secrets and callback keys  | Disable the compromised credential with the provider. Apply and test the replacement with the current versioned configuration and callback verification controls. Reconcile accepted and uncertain provider operations before allowing replay.                                                                                                                                                                                                                                                                                | Verify the replacement and active version, check rejection of the retired key, and preserve one durable outcome for each accepted provider operation. [Provider recovery](../operations/notification-monitoring.md).                                                                                              |
| Customer and staff sessions         | Identify affected accounts and refresh families from protected evidence. Use the confirmed account security workflow for other sessions and sign out the current session when it is affected. Use identity recovery if the account owner has lost control. For a wider incident, contain compromised sign-in access and approve a bounded account and family set. Lock the affected account authority, revoke active sessions and consume unconsumed refresh grants in one audited transaction, and preserve session history. | Verify that old credentials fail at both authenticated and refresh entry points and that a trusted fresh login succeeds. Record aggregate revoked counts and scope. [Session controls](../security/session-lifetime.md). [Account recovery](account-recovery.md).                                                 |
| TLS certificates and private keys   | The ingress operator obtains an approved replacement with a fresh key for each affected hostname. Validate the hostname, chain and renewal path and deploy the replacement through the selected ingress. Coordinate revocation of the compromised certificate with the issuer. For active misuse, revoke immediately and contain affected ingress while the replacement is prepared.                                                                                                                                          | Confirm the new certificate and chain from the live edge, verify renewal configuration and record the retired fingerprint. Use the staging reload procedure when applicable. [Staging certificate reload](../../deploy/staging/certbot-reload-nginx.sh). [Production ingress](../../deploy/production/README.md). |

Record completion and failed verification separately. Escalate an uncertain revoke or credential scope to the incident owner and credential issuer. [Credential compromise](credential-compromise.md).

## Recover and verify

1. Rehearse the affected path in an isolated environment. If recovery needs a restore, use a separate verified target and reconcile accepted writes before any cutover. [Database restore](database-restore.md).
2. Apply the approved compatible fix or rollback. Verify the live image and configuration identity, API and worker readiness, the affected journey, and any relevant authorization or financial invariants. Read back provider and alert receipts before closing the related recovery step. [Deployment rollback](bad-deployment.md).
3. Reopen the capability under the incident owner's direction after verification. Track recurrence, missing alerts and unexplained financial differences. Reopen the incident if the symptoms return or a required safeguard fails.

## Customer communications

Use verified facts and affected recipients. Obtain incident-owner approval through the established channel before publication. Keep detailed evidence, credentials and other customers' information in the protected incident record.

### Confirmed breach

> We confirmed unauthorized access affecting [verified scope] during [time window]. We have [confirmed containment action]. Please [customer action, if needed] through [official channel]. We will update you by [time]. Incident reference [reference].

> دسترسی غیرمجاز به [دامنهٔ تأییدشده] در [بازهٔ زمانی] را تأیید کرده‌ایم. [اقدام مهار تأییدشده] انجام شده است. در صورت نیاز، لطفاً [اقدام کاربر] را از طریق [کانال رسمی] انجام دهید. اطلاع‌رسانی بعدی تا [زمان] انجام می‌شود. شناسهٔ رخداد [شناسه].

### Service disruption

> [Capability] has been disrupted for [affected group] since [time]. [Verified workaround, if available]. We will share the next update by [time] through [official channel]. Incident reference [reference].

> از [زمان]، [قابلیت] برای [گروه تحت تأثیر] دچار اختلال شده است. [راهکار موقت تأییدشده، در صورت وجود]. اطلاع‌رسانی بعدی تا [زمان] از طریق [کانال رسمی] انجام می‌شود. شناسهٔ رخداد [شناسه].

### Credential rotation

> To protect your account, we revoked [affected access] at [time]. Please [sign in again or replace the affected credential] using [official channel]. Contact support through that channel if you cannot restore access. Incident reference [reference].

> برای محافظت از حساب شما، [دسترسی تحت تأثیر] در [زمان] لغو شد. لطفاً از طریق [کانال رسمی] [دوباره وارد شوید یا اعتبارنامهٔ تحت تأثیر را جایگزین کنید]. اگر به حساب دسترسی ندارید، از همان کانال با پشتیبانی تماس بگیرید. شناسهٔ رخداد [شناسه].

## Post-incident review

Within five working days, the incident owner records a UTC timeline from exposure through verification, the confirmed impact, the root cause and contributing controls, and how detection, containment and recovery worked. Record corrective actions with an owner, due date, validation check and closure evidence. Update the affected runbook, threat model and tests, or record which reviewed guidance still applies. Keep evidence and personal details in the protected incident record. Track follow-up in the approved operations project. [Incident response](../operations/incident-response.md). [Threat-model review cadence](../threat-model.md#risk-decisions-and-review-cadence).
