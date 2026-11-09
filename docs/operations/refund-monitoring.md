# Mandatory refund monitoring

The worker exposes the number of distinct outstanding mandatory refunds and the number outstanding for more than one hour. Age starts at the earliest open obligation's creation time. The legacy order and current contract ledgers share a refund identity when an obligation is adopted. The metric counts that identity once. Settled obligations and refunds with no mandatory obligation are excluded. [Refund backlog recovery](../runbooks/refund-backlog.md).

Prometheus takes the maximum count across worker replicas for each environment and database. The P2 alert fires when any obligation is overdue and resolves when the count returns to zero. The protected operations receiver records the occurrence and sends its private administrator inbox intent. The metric and notice carry aggregate state. Use the authorized finance workflow to identify an affected refund and verify settlement. [Alert priorities](service-objectives.md#alert-priorities).
