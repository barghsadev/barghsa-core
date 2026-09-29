# Route bundle budgets

Run `pnpm --filter @barghsa/web build` followed by `pnpm check:bundle` from the repository root. CI runs the same check after its build.

The committed `.size-limit.json` selects routes and budget limits. The manifest resolver includes the entry point, parent layouts, static dependencies and configured first-render chunks once each. It generates a temporary standard Size Limit configuration with absolute asset paths, explicit byte limits and gzip enabled. The pinned Size Limit CLI and file plugin check every complete route. Temporary configuration is removed after success or failure.

Both measurements must pass. The existing default-gzip check remains because Size Limit uses gzip level 9, which can report fewer bytes. Thresholds are unchanged, and the original strict less-than comparison remains. Missing manifest entries, missing assets, an empty configuration, tool errors and tool timeout fail the command. Browser cold-transfer checks remain a separate CI gate.

Interaction-phase rules measure code fetched after an explicit action. They exclude the already-loaded entry bootstrap and sibling dynamic imports with their own interaction budgets, while including every static dependency and unbudgeted nested dynamic import. Initial-route rules still count static imports and any dynamic imports not assigned their own interaction budget. The admin terms editor, publish preview and version viewer are loaded only after staff opens those controls and have separate limits.

Toast feedback loads its renderer when the first success or error is requested. The pending message is shown after the renderer mounts, and the renderer has its own interaction budget. Customer purchase routes stay eager; their initial budgets include their route code.

Size Limit and its file plugin are pinned to 12.1.0, which supports the project's Node 20 baseline as well as the current Node 22/24 tooling. The 13.x release requires a newer Node baseline and was not retained.

The auth build aliases the generated route tree to `apps/web/src/routeTree.auth.ts`, which contains only paths served by the auth entry. Keep it aligned with `apps/web/entry-routes.js` when adding a public auth path. The main build still uses the generated full route tree.

The regression fixture runs the actual CLI. It verifies shared dependency deduplication, admission of a small route, rejection of an oversized shared chunk and rejection of a missing asset.
