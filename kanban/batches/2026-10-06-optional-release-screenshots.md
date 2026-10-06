# Optional release screenshots, October 6, 2026

Release `v0.1.28`. Manual direct-main operational batch supporting the required independent release process.

## Confirmed problem

`v0.1.26` deployed successfully at `84a551d371ce8911a6a25300db948417b057d4bf`. Its exact healthy release and Persian Telegram note `78` are confirmed; the restored-profile screenshot is confirmed as message `79`. The access-denied screenshot has an `unknown` receipt after a remote response failure. The old worker treats this optional screenshot failure as a failed release and prevents queued `v0.1.27` from deploying. The original failure and notification receipts remain external.

Read-only Bot API inspection confirmed that the channel is private and the bot has an active webhook; `getUpdates` returns HTTP 409. No webhook was removed. Human channel confirmation is pending. The unknown image is not automatically resent or marked delivered.

## Built and reviewed

The worker now catches a failed optional screenshot command and rechecks the exact original release's main announcement without images. Only a successful required announcement verification and matching live version/commit allow completion. The job records a `screenshot_warning`; a completed job with that warning does not claim every image was delivered. Existing unknown-send receipts and explicit recovery guard remain intact. Frozen images, immutable worker code, isolated exact-commit checkouts, serialized releases, main-message requirements and failed/interrupted recovery retain their ownership.

No automatic unknown-image retry, fake delivery receipt, CI gate, business-engine change, supervisor-state change or secret exposure. This repairs the user's manual release workflow; no product kanban engine completion is recounted. Root SemVer and Persian notes use `0.1.28`.

## Validation

- **21** release/notifier tests pass, including three new cases proving optional failure advances to a second queued commit, required-main confirmation still blocks, and wrong live identity still blocks.
- The external pre-change test run preserves the optional-queue failure and the unreachable live-identity assertion. Final tests use real temporary Git repositories, pushed commits, isolated checkouts and a detached worker-lock check.
- Web production build and both emitted `0.1.28` metadata files, all 85 unchanged bundle budgets, formatting, backlog and diff checks pass.
- Review verifies the fallback never adds `--retry-unknown`, reuses the original commit, cannot ignore a required announcement failure, preserves live identity validation and retains the warning in durable completed state. No UI or application-source change; prior UI checks are not redundantly rerun. This operational release has no new visual change requiring a screenshot.

## Recovery and publication

After exact normal main-push readback, enqueue `v0.1.28` immediately. Explicitly retry the diagnosed terminal failed `v0.1.26` through the new immutable runner. Required note verification and live identity must pass before it advances to `v0.1.27` and then this release. Keep the unknown image receipt and warning truthful; reconcile the optional image only after channel inspection while its original release is live.

Publication and recovery outcomes remain separate external receipts under `~/.local/state/barghsa-manual-batches/optional-release-screenshots/`. Continue the next customer bank-receipt ownership batch without waiting for deployment or CI.
