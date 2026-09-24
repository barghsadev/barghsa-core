# Provider transport fakes

Canonical scope: `05-notifications-documents-ai.md#T-05.08.05`.

Deterministic SMTP, Resend, and SMS.ir fake transports implement the worker's notification transport contract without network calls or provider credentials. Each supports scripted success, transient failure, and permanent rejection, and replays an accepted idempotency key with the same receipt. Contract tests check error classification, channel binding, cancellation, and receipt stability for all three adapters.

Validation: the fake contract suite runs in CI without external services; worker typecheck, lint, and build pass.
