# Browser content security policy

The web server creates a new nonce for each HTML response and applies it to scripts, module preloads and style elements from the trusted build. Responses carrying that nonce are private and must not be cached. The policy keeps scripts nonce-bound, forbids eval and plugins, limits requests and form submissions to the app origin, and denies framing. The proxy also sends `X-Frame-Options: DENY` independently.

Both browser entry points set Zod's `jitless` configuration in the nonce-bearing HTML before modules load. Financial review schemas use the regular validator with the same inputs and errors. The production browser regression loads the compiled finance bundle under enforced CSP and uses a separate controlled violation to confirm that the browser reports blocked evaluation. Keep the configuration ahead of module execution and verify it after upgrading Zod. [Zod compilation policy](https://zod.dev/compile).

Stylesheets load from the app origin. Inline style elements require the response nonce or one of two exact hashes for the fixed stylesheets from Sonner 2.0.8 and Base UI 1.7.0. The production header check recomputes both hashes from the installed packages. Recheck actual toast and scrollbar styling after upgrades. Onboarding confetti uses a bundled stylesheet. The narrower `style-src-attr 'unsafe-inline'` retains computed style attributes such as progress indicators and branding.

The Sonner package patch fills the stylesheet before inserting it in the document. Inserting an empty element first produces an inline-style violation before the browser can match the approved CSS hash. The registration-feedback browser check verifies the styled toast and checks for inline-style reports before taking any screenshot. WebKit screenshot automation can itself insert a transient style. Correlate those events with the capture before classifying them.

Compose passes `BARGHSA_WEB_CSP_MODE` to the web process. The default is `report-only`. Reports go to `/api/csp-report`, which checks browser provenance, size and rate before logging sanitized diagnostics with a correlation ID. Keep collection available in both modes. Verify that a controlled report reaches the deployed log sink, review one week of reports and resolve legitimate application violations. Rehearse customer and staff journeys in the affected browsers before switching to `enforce`. If enforcement disrupts a legitimate route, return to `report-only` and preserve the reports for diagnosis.

HSTS is an ingress policy. Enable it only after verifying production TLS and the impact on subdomains. This policy does not enable preload.

The pilot and staging proxies emit one value for `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `X-Frame-Options`. They replace those four upstream fields and keep the existing CSP handling. The proxy checks verify the exact header values and count on HTTPS success and proxy-generated size and rate-limit responses.
