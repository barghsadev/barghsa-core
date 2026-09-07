# Route bundle budgets

Run `pnpm --filter @barghsa/web build` followed by `pnpm check:bundle` from the repository root. CI runs the same check after its build.

The committed `.size-limit.json` selects routes and budget limits. The manifest resolver includes the entry point, parent layouts, static dependencies and configured first-render chunks once each. It generates a temporary standard Size Limit configuration with absolute asset paths, explicit byte limits and gzip enabled. The pinned Size Limit CLI and file plugin check every complete route. Temporary configuration is removed after success or failure.

Both measurements must pass. The existing default-gzip check remains because Size Limit uses gzip level 9, which can report fewer bytes. Thresholds are unchanged, and the original strict less-than comparison remains. Missing manifest entries, missing assets, an empty configuration, tool errors and tool timeout fail the command. Browser cold-transfer checks remain a separate CI gate.

Size Limit and its file plugin are pinned to 12.1.0, which supports the project's Node 20 baseline as well as the current Node 22/24 tooling. The 13.x release requires a newer Node baseline and was not retained.

The regression fixture runs the actual CLI. It verifies shared dependency deduplication, admission of a small route, rejection of an oversized shared chunk and rejection of a missing asset.
