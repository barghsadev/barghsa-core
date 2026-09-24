# Admin theme tokens

Canonical scope: `01-platform-infrastructure.md#T-06.03.05` (admin override portion).

The branding draft now controls light and dark page backgrounds, font family, corner radius, and spacing scale alongside the existing palette and identity fields. The admin editor previews these settings and rejects background colors that fail 4.5:1 contrast against the corresponding body text. Activation publishes the values through the public branding response, and the web provider applies them as CSS variables on `<html>`. Older active brand records receive safe defaults for the new fields. The existing draft → active → superseded lifecycle is unchanged.

Validation: 37 focused API tests, 389 focused web tests, four Chromium branding flows (Persian/English × light/dark, including computed CSS and contrast), all 11 workspace typechecks, all seven builds, contract drift, changed-file lint/format, and backlog validation pass. Per-user light/dark preference is the remaining part of this canonical task.
