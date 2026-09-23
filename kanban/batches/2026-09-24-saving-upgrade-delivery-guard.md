# Saving delivery upgrade guard — September 24, 2026

Canonical scope: staff fulfillment controls in `03-core-business.md#T-03.10.01.02`, matching the existing API guard for paid equipment upgrades.

When a saving order has a pending equipment-upgrade charge, staff now see why product delivery cannot advance, even if the original invoice is paid. The completion action remains disabled until that charge is resolved. The existing paid-invoice and active-contract explanations remain in place, in Persian and English. The API still checks all prerequisites at commit time.

A focused browser journey covers the paid-original-invoice/pending-upgrade case, the final-stage inactive-contract case, and readiness after the contract becomes active. The browser API is controlled; backend fulfillment tests cover authoritative transitions.

Validation: focused five-browser journey, web and i18n typechecks, targeted lint and formatting, dictionary tests, and backlog validation.
