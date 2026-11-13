# Pilot reverse proxy

The supported pilot proxy is NGINX with operator-supplied TLS certificate files. The epic permits NGINX or Caddy. The previous Caddy alternative was removed because its configuration did not parse with the documented standard image and depended on an unprovided rate-limit plugin.

Use `nginx.conf` on the pilot host. Its upstreams are the API at `127.0.0.1:4000` and web at `127.0.0.1:3000`. Production compose publishes these application ports only on host loopback. Public traffic must reach NGINX's TLS listener. This configuration does not turn the development backing-service compose into a certified production installation.

An all-in-one pilot targets 99.5% availability without an HA commitment. Loss of the host stops every service. Keep encrypted backups outside the host and rehearse recovery. Use separate PostgreSQL and versioned object storage before enabling real customer payments. [Topology and availability policy](../../docs/adr/003-hybrid-deployment.md#5-documented-lower-availability-for-single-server-deployments). [PostgreSQL backup and restore runbook](../../docs/operations/backup/postgresql-restore-runbook.md).

Before rollout:

- Replace `barghsa.example.com` with the intended public host and supply `/etc/ssl/certs/barghsa.pem` plus `/etc/ssl/private/barghsa.key`. Keep certificate private keys outside Git.
- Set `API_TRUSTED_PROXY_IPS` in the external runtime environment to the immediate proxy's exact socket address as observed by the API. Host-to-container traffic usually arrives through a Docker bridge gateway; inspect that deployment rather than assuming loopback. A native API beside NGINX can use `127.0.0.1,::1`. Empty means no proxy trust. Wildcards, hop counts, hostnames and CIDRs are rejected.
- Keep the API inaccessible through a public alternative route. NGINX replaces inbound forwarded-address headers. If adding another proxy/load balancer, review that topology and configure its trusted chain explicitly; do not turn on blanket trust.
- Verify TLS, certificate renewal and HTTPS on every affected subdomain before approving HSTS on the production host. Staging and the default pilot configuration suppress upstream HSTS. CSP has its own Report-Only rollout.

For an authorized production rollout, render the pilot configuration to a protected file and validate it before switching the active configuration:

```sh
BARGHSA_DEPLOYMENT_ENV=production BARGHSA_PILOT_HSTS=true \
  python3 deploy/pilot/render-nginx.py > /protected/barghsa-pilot-nginx.conf
nginx -t -c /protected/barghsa-pilot-nginx.conf
```

Apply the intended public hostname to the rendered file before validation. The renderer requires explicit production selection to emit the one-year HSTS policy with subdomains. The header is sent on HTTPS only, including locally generated errors.

## Deploy between pilot slots

The pilot launcher runs two Compose projects on one application host. The
blue web and API listeners use loopback ports `3000` and `4000`. Green uses
`13000` and `14000`. The worker, inference and scanner stay on each project's
private network. Both slots use the approved external database and object
store. Provision both scanner caches with current signatures and reserve
capacity for both slots during the switch.

Bootstrap the first slot with the production Compose runbook, the project
name `barghsa-pilot-blue` and the encrypted launcher’s `--pilot` option.
Set `BARGHSA_PILOT_TRANSITION_DIR` to a dedicated operator-owned directory
with read and traverse access for the app user. The launcher mounts it
read-only in the API. Verify the active NGINX configuration has the blue
upstream ports and its actual PID file. Keep the inactive slot stopped.
Use a release that reports its API commit and supports the pilot mount.
Before a release, verify that the previous app and worker can run against
the candidate schema and share its job queues for the short overlap. Use
expand/migrate/contract and rehearse rollback with the previous images.
[Production image and migration instructions](../production/README.md).

Prepare a protected JSON plan for the authorized pilot host. Set `hostname`
to the TLS name and `proxy_config` and `proxy_pid` to the absolute active
NGINX paths. Set `compose_env` to the protected Compose settings file and
`runtime` and `migration` to the separate host-key-encrypted credentials.
Set `transition_dir` to the dedicated directory used at bootstrap.
Set `drain_seconds` to the approved wait for in-flight requests, between 5
and 600 seconds. Under both `previous` and `candidate`, record `slot`, the
full source `commit`, and `images`. In `images`, provide `app`, `web`, and
`scanner` objects with `ref` for the registry reference including its digest
and `id` for the platform image ID from the scan receipt. Use the same
verified scanner image for both slots. Set `EXPECTED_MIGRATION_ID` in the
migration credential to the candidate's packaged migration head.

For a schema change, set `schema_transition_verified` to `true` after the
release compatibility review confirms both exact images can use the expanded
schema. The launcher verifies that the candidate journal extends the old
image's complete journal, both images support pilot transitions, and the
active API has the protected read-only mount and correct revision. It then
records the exact two migration heads. Readiness for the previous image
accepts only that approved successor and still requires the exact previous
migration row. Regular deployments keep the packaged-head check.

After explicit production authorization for the exact candidate and host,
run this on the approved pilot application host:

```sh
deploy/pilot/deploy-pilot.sh --plan /protected/pilot-plan.json
```

The launcher verifies the previous slot, pulls the exact candidate images
and checks the local image IDs and app/web source labels. It runs the
packaged migration with the separate credential, checks the previous TLS
route again, and starts the candidate containers. It checks all five
containers, API readiness, and the exact API and web release commits
before validating and reloading NGINX. It verifies the new TLS route,
waits for the previous NGINX workers to finish their requests, checks
candidate health again and then stops the previous slot. Its success output
records the active slot and exact source commit. It removes the active
schema transition after the final candidate smoke passes.

A failure before retirement keeps the previous slot available. After an
attempted switch the launcher restores the previous configuration, verifies
the previous route, and drains candidate proxy workers before stopping the
candidate. If recovery or cleanup remains uncertain, inspect both slots and
the actual TLS route before retrying. The protected `.previous` copy next
to the active config and the retained slot containers support operator
recovery after an interruption. The database migration remains applied.
If the final smoke fails after retirement, the launcher restarts the previous
slot and verifies its images and readiness before restoring the TLS route.
It stops the candidate only after the previous route is verified and the
candidate's proxy workers have drained.
The active schema transition remains available to the prior API on rollback.
For a later authorized rollback, the protected `.schema.json` copy in the
transition directory records the exact reviewed heads. Reconcile the actual
database head before restoring that transition and restarting the prior slot.
[Rollback runbook](../../docs/runbooks/bad-deployment.md).

`python3 scripts/test-pilot-proxy.py` validates the actual NGINX configuration, then boots it in an isolated container network namespace with test-only certificates and echo/streaming upstreams. It opens no host ports and removes its containers and certificate files on exit. It requires local Docker, OpenSSL, `nginx:1.27-alpine` and `node:22-bookworm`; Node is only the HTTP fixture, not a production application image.

The check verifies certificate hostname, TLS 1.2 ECDHE AEAD and TLS 1.3 handshakes, and rejection of legacy TLS, CBC and static RSA. It checks the HSTS policy on HTTPS success, oversized requests and local 429 responses, and checks that redirects omit it. It also covers routing, response headers, a 10 MiB body boundary rejection, forwarded-header overwrite, unbuffered SSE, WebSocket upgrade and fa/en 429 behavior on auth/upload/AI quotas. API tests separately cover exact proxy trust and PostgreSQL destination quotas across client addresses.

Cache policy comes from the web server after it resolves a real file. Hashed
assets, including the separate auth entry, receive one year and immutable;
other static files receive one day. HTML remains private/no-store. Missing
assets return404/no-store rather than the SPA document. NGINX preserves those
headers and adds no extension-based expiry override. Deploy the web server and
proxy configuration together. The proxy check includes seven successful,
private and error cache-policy cases; the web tests verify file classification.

API ETags are opt-in SHA-256 validators for safe reference data. Geography
province/city/company-type lists retain session guards and private/no-store
headers; matching validators reduce response bytes without bypassing current
queries or access checks. Product prices, profile and wallet payloads are not
opted in. Express automatic validators are disabled. GET/HEAD conditionals on
non-opted-in routes do not suppress their response; errors are never tagged.
