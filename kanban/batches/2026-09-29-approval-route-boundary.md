# Approval route boundary follow-up

Canonical scope: CI follow-up to [exact approval-request handoff](2026-09-29-approval-request-handoff.md).

The approval route now normalizes valid request IDs before the exact API read, accepting uppercase UUIDs and surrounding whitespace. Its router-aware wrapper is separate from the approval view so generic load-failure tests can render the view without a router; the browser journey still exercises the real route and deep link.

Validation: 380 admin-boundary unit cases, approval-queue Chromium journeys, web typecheck, changed-file lint and formatting, production build and route budgets.
