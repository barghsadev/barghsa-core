# Auth route payload budget

Task context: `01-platform-infrastructure.md#T-01.03.03` and `01-platform-infrastructure.md#T-01.03.04` (auth entry slice).

The production auth build now uses a small route tree containing login, registration, verification, activation and password recovery. The main build keeps the generated full route tree. This removes customer and admin route definitions from auth startup without changing the page components or auth-to-app redirects. The auth entry path list and this route tree must be updated together when a new public auth route is added.

The default-gzip route budgets now pass: login 138.6 KB, registration 140.7 KB, registration verification 131.0 KB, password recovery 137.9 KB, all below 150 KB. The pinned Size Limit CLI also accepts every auth rule. Production-preview Chromium browser tests pass for 37 login, registration and password-recovery cases, three staff-activation cases, and four bilingual light/dark public-theme cases. The theme fixture was updated to provide the complete validated branding response.

The full route-budget command still fails on the dashboard, electricity ordering, and admin terms routes. Those require separate performance batches; no limit was raised.
