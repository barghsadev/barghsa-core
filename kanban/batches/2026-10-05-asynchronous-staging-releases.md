# Asynchronous staging release queue

Status: built and reviewed. Direct-main publication and queued deployment are recorded outside the checkout. CI is informational for this disposable test environment and does not gate deployment or the next build.

## Scope and workflow

This batch implements the user's release-workflow correction; it does not recount product tasks. After related local checks and a direct main push, `release-queue.py enqueue --commit <full-pushed-sha>` freezes the commit, worker source and selected PNGs, starts a detached worker, and returns immediately. Builds continue in the main checkout. The worker invokes the required `./deploy/staging/deploy.sh` in a detached exact-commit checkout, then sends reviewed screenshots through the existing Persian notifier.

Releases serialize through deployment and notification confirmation. Jobs, logs, frozen runners and screenshots live in `~/.local/state/barghsa-staging-queue`. Failed/interrupted releases stop the deployment queue with explicit recovery; the existing health/live-identity and duplicate/uncertain Telegram safeguards remain. The worker reads live metadata back before completing a job. Later worker starts preserve a failed job's original error until explicit recovery. Historical supervisor/PR state is unchanged.

## Verification

- Eight focused queue tests use real local Git repositories and pushed commits. They verify immutable screenshot/deduplication behavior, deployment of an older commit while the builder has advanced and has dirty files, failed/interrupted queue recovery, retained failure diagnostics, wrong-live-identity rejection, unpublished/malformed commit rejection, version reuse rejection, and nonblocking worker startup while another worker holds the deployment lock.
- All ten existing notification tests pass alongside the queue tests. Notification behavior and credentials are unchanged.
- Python compilation and the web production build pass. The rebuilt Persian login shows `v0.1.3`; its complete original screenshot was inspected for release attachment. All 85 unchanged bundle budgets pass. Existing strict application SAST passes with zero findings/errors and all five rule fixtures. Formatting, diff checks and canonical backlog validation precede publication.
- The preceding geography release **v0.1.2** deployed in an independent exact-commit checkout while this batch was built. Service/S3 health and live commit metadata pass; the public login shows `v0.1.2`. Persian Telegram notes and two screenshots are confirmed as messages **9, 10 and 11**. CI was not a gate.

Evidence is in `~/.local/state/barghsa-manual-batches/asynchronous-staging-releases`; the preceding deployment evidence is in `~/.local/state/barghsa-manual-batches/geography-native-forms`. Release **v0.1.3** is pushed and queued after its checks. Continue the next uncovered coherent product batch immediately, using GitHub CLI and no PRs; do not wait for CI or the release worker.
