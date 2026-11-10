# Route bundle budgets

Run `pnpm --filter @barghsa/web build` followed by `pnpm check:bundle` from the repository root. CI runs the same check after its build.

The committed `.size-limit.json` selects routes and budget limits. The manifest resolver includes the entry point, parent layouts, static dependencies and configured first-render chunks once each. It generates a temporary standard Size Limit configuration with absolute asset paths, explicit byte limits and gzip enabled. The pinned Size Limit CLI and file plugin check every complete route. Temporary configuration is removed after success or failure.

Both measurements must pass. The existing default-gzip check remains because Size Limit uses gzip level 9, which can report fewer bytes. Thresholds are unchanged, and the original strict less-than comparison remains. Missing manifest entries, missing assets, an empty configuration, tool errors and tool timeout fail the command. Browser cold-transfer checks remain a separate CI gate.

Interaction-phase rules measure code fetched after an explicit action. They exclude the already-loaded entry bootstrap and sibling dynamic imports with their own interaction budgets, while including every static dependency and unbudgeted nested dynamic import. Initial-route rules still count static imports and any dynamic imports not assigned their own interaction budget. The admin terms editor, publish preview and version viewer are loaded only after staff opens those controls and have separate limits.

Contract review and signature schemas load on the first field validation or submit, with a separate 20 KB interaction limit. The contract detail limit remains 250 KB. Every static dependency of the schema counts toward its own limit; a static import from the detail also counts toward the detail limit.

Toast feedback loads its renderer when the first success or error is requested. The pending message is shown after the renderer mounts, and the renderer has its own interaction budget. Customer purchase routes stay eager; their initial budgets include their route code.

Size Limit and its file plugin are pinned to 12.1.0, which supports the project's Node 20 baseline as well as the current Node 22/24 tooling. The 13.x release requires a newer Node baseline and was not retained.

The auth build aliases the generated route tree to `apps/web/src/routeTree.auth.ts`, which contains only paths served by the auth entry. Keep it aligned with `apps/web/entry-routes.js` when adding a public auth path. The main build still uses the generated full route tree.

The regression fixture runs the actual CLI. It verifies shared dependency deduplication, admission of a small route, rejection of an oversized shared chunk and rejection of a missing asset.

## Primary mobile pages

CI runs the existing sign-in and populated electricity, savings, solar and consultation history journeys on a cold Chromium mobile profile in Persian and English. The profile uses 4 Mbit/s download, 1 Mbit/s upload, 100 ms network latency and 2× CPU slowdown. It requires largest contentful paint and the first visible form or history row in under 2,500 ms, cumulative layout shift at most 0.1 and startup blocking at most 200 ms. The blocking measurement sums the portions of startup long tasks above 50 ms. Field interaction latency requires real-user measurement. [Core Web Vitals](https://web.dev/articles/vitals) · [Total Blocking Time](https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time)

The production build stores smaller Brotli and gzip copies of content-hashed JavaScript and CSS. The server selects an acceptable encoding and retains the original asset for clients that request identity. The four history entry pages also receive nonce-bearing preload links to their initial JavaScript, resolved from the build manifest. Interaction chunks keep their existing lazy loading. [HTTP Accept-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.3)

The workspace can replace its loading skeleton as soon as the route is ready. The fresh session check remains part of route loading. Other router boundaries keep their default minimum loading duration.
