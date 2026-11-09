# Docker Desktop release client

If a staging build stops at registry metadata, inspect the build process and its
credential-helper child before retrying. A reachable registry alone does not
prove the credential helper has returned.

When an anonymous manifest request succeeds but the release's credential-helper
child remains stuck, use an isolated Docker client configuration for this release.
Keep the same trusted Docker engine endpoint from `docker context inspect` and
retain the existing Buildx plugin directory through `cliPluginsExtraDirs`. The
isolated `config.json` contains an empty `auths` object and no credential store.
Protect its directory with mode 0700 and its files with mode 0600. Keep registry
TLS verification enabled and leave the global Docker configuration untouched.

Confirm the child belongs to the stalled release before terminating only that
child. Let the existing worker record the failed build. Inspect its log and
notification receipts, then explicitly retry that exact failed commit with
`DOCKER_CONFIG` and `DOCKER_HOST` set only in the retry process environment. The
detached worker inherits them. A successful anonymous manifest probe does not
authorize retrying an unknown deployment or Telegram send.

Keep the isolated configuration until the worker finishes. Record the original
failure and actual retry/deployment receipts in the board's release evidence.
Do not reset Docker Desktop, remove global credentials or restart unrelated jobs.

If Docker Desktop itself is unavailable, an authorized Linux amd64 engine can
build the same immutable staging checkout over SSH. Set `DOCKER_HOST` and the
isolated `DOCKER_CONFIG` only for the release worker. Confirm the engine has
capacity and can fetch the exact locked dependencies before choosing it. If
one registry address works and the build's default resolution times out, scope
the verified address to the build only. Keep the registry hostname, TLS and
lockfile integrity checks intact. Do not change server-wide DNS.
