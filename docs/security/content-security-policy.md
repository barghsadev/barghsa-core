# Browser content security policy

The web server creates a new nonce for each HTML response and applies it to scripts, module preloads and style elements from the trusted build. Responses carrying that nonce are private and must not be cached. The policy keeps scripts nonce-bound, forbids eval and plugins, limits requests and form submissions to the app origin, and denies framing. The proxy also sends `X-Frame-Options: DENY` independently.

Stylesheets load from the app origin. Inline style elements require the response nonce or one of two exact hashes for the fixed stylesheets from Sonner 2.0.8 and Base UI 1.7.0. The production header check recomputes both hashes from the installed packages. Recheck actual toast and scrollbar styling after upgrades. Onboarding confetti uses a bundled stylesheet. The narrower `style-src-attr 'unsafe-inline'` retains computed style attributes such as progress indicators and branding.

Compose passes `BARGHSA_WEB_CSP_MODE` to the web process. The default is `report-only`. Reports go to `/api/csp-report`, which checks browser provenance, size and rate before logging sanitized diagnostics with a correlation ID. Keep collection available in both modes. Verify that a controlled report reaches the deployed log sink, review one week of reports and resolve legitimate application violations. Rehearse customer and staff journeys in the affected browsers before switching to `enforce`. If enforcement disrupts a legitimate route, return to `report-only` and preserve the reports for diagnosis.

HSTS is an ingress policy. Enable it only after verifying production TLS and the impact on subdomains. This policy does not enable preload.
