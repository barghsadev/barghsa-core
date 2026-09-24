# Provider operations runbook

Canonical scope: `05-notifications-documents-ai.md#T-05.08.04`.

The staff provider page now links to the shared SMTP, Resend, and SMS.ir runbook in the selected language. It documents application timeouts, configured and external throughput limits, transient/permanent error signatures, bounded retry and breaker behavior, safe rate-limit recovery, reconciliation of uncertain sends, and escalation to the appropriate operations and provider owners. The runbooks do not invent provider account quotas or support contacts that vary by account.

Validation: provider page build and typecheck, localized browser checks, formatting, and kanban validation.
