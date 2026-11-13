# Authenticated journey availability

For a P1 fast burn, the on-call operator verifies customer impact and opens an incident. For a P2 slow burn, the owning service team opens a time-bounded investigation. Identify the affected service, environment, database and availability tier in the Executive SLO dashboard.

1. Verify that the collector is current and that both success and failure counters cover the affected scope. Compare attempt counts and recent scrape health. Check the service with an authorized read-only customer fixture. Record missing measurements as unknown.
2. Check the release revision, API errors and latency, database and worker readiness, and the service's critical dependencies. Preserve payment, refund and contract evidence. Follow the relevant containment and recovery procedure when the failure is confirmed.
3. Read back the affected authenticated journey, both burn windows and the resolved alert. Record the incident reference, owner, before and after attempt counts and delivery receipts.

For a P1 synthetic failure, inspect the reported check and its validated correlation ID in the independent runner journal. Verify the affected public endpoint or the dedicated customer fixture before attributing the result to customer traffic. The Executive SLO dashboard shows the last run age and the checks executed by a fresh runner.

For a P1 synthetic reporting outage, check the configured scrape target, timer, recent unit status and protected fixture configuration. Verify the completion timestamp and the check results on that same target. A complete successful run reports all nine checks. A reported failed check feeds its own alert even when later checks are skipped. The failure and unavailable rules feed the private operations receiver. Verify the approved P1 pager route with a firing and resolved receipt before relying on it for on-call delivery.

For `PublicTlsCertificateExpiring`, platform operations checks the public certificate in the Executive SLO dashboard during working hours. The alert fires when a fresh runner sees a trusted public certificate with 14 days or less remaining. Verify the configured public origin and the certificate served to an external client, review the renewal timer and recent renewal-hook results, and verify that the public listener serves the renewed certificate before closing the review. Treat a certificate trust failure as a synthetic availability failure. An absent certificate metric requires checking the runner and public TLS reachability before recording renewal as verified.

[Service objectives](../operations/service-objectives.md) · [Incident response](../operations/incident-response.md) · [Bad deployment and rollback](bad-deployment.md)
