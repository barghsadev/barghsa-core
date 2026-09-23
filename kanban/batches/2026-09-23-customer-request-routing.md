# Solar and consultation customer routing — September 23, 2026

Canonical scope: customer access to `03-core-business.md#T-03.03.02.03`, `T-03.03.02.04`, and `T-03.11.03.03`; browser coverage toward `T-03.90.14`.

The solar request list and consultation page were parent routes that did not render child outlets. Solar intake/detail and consultation detail therefore showed the parent page instead of the requested screen. Their lists are now index routes with outlet-only parents. List links and successful submission redirects use client-side navigation, preserving the selected language and opening the child route immediately.

Two Chromium cases cover solar list → intake, direct solar detail with its status banner, consultation list → detail with its status banner, and a new consultation submission → detail. Controlled API responses isolate routing and rendering; backend state transitions remain covered by their HTTP integration suites. These checks do not complete the full cross-product journey task `T-03.90.14`.

Validation: two Chromium browser cases, all 977 web tests, web typecheck and production build, targeted lint and formatting, and backlog validation passed locally. CI passed on `main` in [run 35911316605](https://github.com/barghsadev/barghsa-core/actions/runs/35911316605).
