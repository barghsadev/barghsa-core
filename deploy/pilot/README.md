# Pilot reverse proxy

The supported pilot proxy is NGINX with operator-supplied TLS certificate files. The epic permits NGINX or Caddy. The previous Caddy alternative was removed because its configuration did not parse with the documented standard image and depended on an unprovided rate-limit plugin.

Use `nginx.conf` on the pilot host. Its upstreams are the API at `127.0.0.1:4000` and web at `127.0.0.1:3000`. Production compose publishes these application ports only on host loopback. Public traffic must reach NGINX's TLS listener. This configuration does not turn the development backing-service compose into a certified production installation.

Before rollout:

- Replace `barghsa.example.com` with the intended public host and supply `/etc/ssl/certs/barghsa.pem` plus `/etc/ssl/private/barghsa.key`. Keep certificate private keys outside Git.
- Set `API_TRUSTED_PROXY_IPS` in the external runtime environment to the immediate proxy's exact socket address as observed by the API. Host-to-container traffic usually arrives through a Docker bridge gateway; inspect that deployment rather than assuming loopback. A native API beside NGINX can use `127.0.0.1,::1`. Empty means no proxy trust. Wildcards, hop counts, hostnames and CIDRs are rejected.
- Keep the API inaccessible through a public alternative route. NGINX replaces inbound forwarded-address headers. If adding another proxy/load balancer, review that topology and configure its trusted chain explicitly; do not turn on blanket trust.
- Validate TLS and affected subdomains before enabling the commented HSTS directive. CSP remains Report-Only pending its separate rollout. Certificate renewal, public DNS and production topology remain operational responsibilities.

`python3 scripts/test-pilot-proxy.py` validates the actual NGINX configuration, then boots it in an isolated container network namespace with test-only certificates and echo/streaming upstreams. It opens no host ports and removes its containers and certificate files on exit. It requires local Docker, OpenSSL, `nginx:1.27-alpine` and `node:22-bookworm`; Node is only the HTTP fixture, not a production application image.

The check covers TLS 1.2/1.3, redirects, routing, response headers, a 10 MiB body boundary rejection, forwarded-header overwrite, unbuffered SSE, WebSocket upgrade and fa/en 429 behavior on the specified auth/upload/AI quotas. Real API tests separately cover exact proxy trust and PostgreSQL destination quotas across client addresses. These local checks do not constitute a production TLS deployment or HA acceptance.
