# Browser content security policy

The web server creates a new nonce for each HTML response and applies it to scripts and module preloads from the trusted build. Responses carrying that nonce are private and must not be cached. The policy keeps scripts nonce-bound, forbids eval and plugins, limits requests and form submissions to the app origin, and denies framing. The proxy also sends `X-Frame-Options: DENY` independently.

The built app and authentication shells currently have no inline style elements. The platform policy retains `style-src 'self' 'unsafe-inline'` for the shared UI's dynamic style attributes, including progress indicators and branding. A fixed style hash would not cover those computed values. Do not change this separately from browser checks of both shells and the affected routes.

Compose passes `BARGHSA_WEB_CSP_MODE` to the web process. The default is `report-only`. Reports go to `/api/csp-report`, which checks browser provenance, size and rate before logging sanitized diagnostics with a correlation ID. Keep collection available in both modes. Verify that a controlled report reaches the deployed log sink, review one week of reports and resolve legitimate application violations. Rehearse customer and staff journeys in the affected browsers before switching to `enforce`. If enforcement disrupts a legitimate route, return to `report-only` and preserve the reports for diagnosis.

HSTS is an ingress policy. Enable it only after verifying production TLS and the impact on subdomains. This policy does not enable preload.
