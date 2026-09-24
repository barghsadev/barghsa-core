# Provider alert history

Canonical scope: `05-notifications-documents-ai.md#T-05.08.03` (per-provider alert history in the staff dashboard).

PostgreSQL now records an alert event exactly when an email or SMS circuit opens or recovers. The trigger runs in the same transaction as the breaker update, so a rolled-back or competing update cannot leave a false or duplicate event. The staff provider lists show the five newest events from the last 30 days, alongside permanent failed delivery attempts already kept in immutable delivery history. Explicit provider rejections now retain their permanent category in that history, even when the sanitized message sounds like a transient socket refusal. Events show a safe category and timestamp, never raw provider responses or credentials. Labels are available in Persian and English.

Validation: real PostgreSQL breaker tests cover concurrent trip and recovery transitions for email and SMS; provider and worker integration tests cover permanent-failure history. Four browser cases cover both channels in both languages. Workspace typecheck, schema snapshot, lint, and focused web tests pass. Low-credit alerts still require provider balance telemetry; SMS.ir's configured threshold alone is not a measured balance.
