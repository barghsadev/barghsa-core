# Versioned staging releases and Telegram summaries, October 5, 2026

This is the user-requested operations batch for deployment after every manual
task batch. It does not mark additional domain tasks or global UI parents complete.

The root package version starts at `0.1.0`. Both application and authentication
builds read that value, display it in the public authentication footer with
bilingual text and LTR version digits, and publish matching `release.json`
metadata. Docker receives the committed release SHA explicitly. Release metadata
revalidates on the production server rather than inheriting the one-day static
file cache policy.

`./deploy/staging/deploy.sh` checks versioned release notes and the configured
Telegram channel before building, retains the existing health/rollout/rollback
procedure, then verifies the live version and exact commit before notification.
Messages contain the version, concrete change list, staging URL and commit.
Confirmed receipts prevent duplicate sends. An uncertain send is retained outside
the checkout and needs channel inspection before an explicit retry. Failed
deployments cannot send a success message. No automatic deployment or notification
is claimed by this report; actual publication and deployment receipts are separate.

The user identified `@barghsa_dev_bot` and Barghsa Release Radar. Telegram verified
the bot username, channel title, channel ID `-1004467450624` and posting permission.
The token was read privately from the ignored `.env` and saved in an external
permission-600 config file. No credential appears in source, notes or metadata.

The preceding lifecycle commit's CI exposed one stale closure-queue test: its
partial mock preview was rejected and its manual input ID was replaced by the
shared native form ID. The failure reproduced locally. The repair reuses the
existing complete preview fixture and actual input name/type, retaining every
mounted-node, raw-password, consent, read-count and denial assertion. The complete
14-case file passes afterward. CI configuration and production closure code stay
unchanged.

Validation completed before publication:

- Root build: seven successful tasks; root typecheck: eleven successful tasks.
- Web server, shutdown and retained login source tests: 48 cases pass.
- Notification and real deployment-script subprocess tests: eight cases pass,
  covering failed preflight, failed rollout, verified announcement, duplicate
  suppression, wrong live identity, wrong receipt, uncertain outcomes, channel
  validation, private configuration and release-note validation.
- CI compatibility repair: all 14 complete-file tests pass; web typecheck and
  scoped lint pass after the test-only repair.
- Browser: eight Chromium/mobile Safari cases pass with zero retries, including
  four retained native-login cases and four bilingual version-display cases.
- Four original full-page version screenshots inspected by the root reviewer.
  The footer is visible, RTL version digits remain LTR, and overflow assertions
  pass. No comprehensive accessibility certification is claimed.
- Scoped lint, supported-file formatting, shell syntax, Docker context tests,
  contracts, suppression checks, all 85 unchanged budgets and canonical backlog
  validation pass. The first format invocation wrongly included a Dockerfile
  unsupported by Prettier; the corrected supported-file invocation passes.
- Strict SAST: 1,782 files, zero findings/errors and five passing rule fixtures.

Local preview metadata identifies the pre-publication base commit. Deployment
builds replace that metadata with the final committed SHA through the Docker build
argument; exact live verification is required before sending the message.

Evidence is stored outside the checkout under
`~/.local/state/barghsa-manual-batches/staging-version-and-telegram`. The previous
CI failure log is retained under the profile lifecycle batch's evidence directory.
Direct-main publication, exact-commit GitHub CI and the actual deployment/Telegram
outcome must be read from their external receipts rather than inferred from this
pre-publication report.

The first deployment attempt failed before migrations while pulling an already
installed pinned Redis digest: the VPS could not resolve Docker Hub. The existing
rollback ran and no Telegram message was sent. Both pinned infrastructure digests
were verified installed, and the host's Compose CLI supports `--policy missing`.
The release now uses that native policy, avoiding redundant registry requests for
installed exact digests while retaining failed-pull blocking for missing images.
The installed-image path was verified on the VPS. This is a repair within the
same initially unshipped `0.1.0` batch, not a separate completed release.

For every subsequent coherent batch: bump the shared Semantic Version, add its
release notes, build and review, pass related checks, commit and normally push to
`main`, run `./deploy/staging/deploy.sh`, verify the deployed identity and retain
the confirmed Telegram receipt. Use GitHub CLI and no PRs. Do not reuse a published
version for a different batch. Existing scheduler/supervisor state and generated
kanban files are unchanged.
