# License-policy review

The canonical T-05.03.04 requirement specifies an allowlist of MIT, Apache-2.0, ISC, BSD-2-Clause and BSD-3-Clause. This inventory applies that written list literally; it is not a legal assessment of these licenses.

`pnpm licenses list --json` on the repaired dependencies identified the following packages outside that list. No risk exception or expanded license policy has been approved. Conjunctive Apache/MIT and alternative MIT/CC0 expressions can satisfy the written list. The full normalized inventory is in `license-inventory.json`.

| Package | Installed versions | Reported license |
| --- | --- | --- |
| @csstools/color-helpers | 6.1.1 | MIT-0 |
| @csstools/css-syntax-patches-for-csstree | 1.1.8 | MIT-0 |
| nodemailer | 9.0.5 | MIT-0 |
| argparse | 2.0.1 | Python-2.0 |
| axe-core | 4.13.0 | MPL-2.0 |
| lightningcss | 1.32.0 | MPL-2.0 |
| lightningcss-darwin-arm64 | 1.32.0 | MPL-2.0 |
| caniuse-lite | 1.0.30001809 | CC-BY-4.0 |
| fs-monkey | 1.1.0 | Unlicense |
| isbot | 5.2.1 | Unlicense |
| memfs | 3.5.3 | Unlicense |
| tweetnacl | 0.14.5 | Unlicense |
| glob | 13.0.6 | BlueOak-1.0.0 |
| isexe | 3.1.5, 4.0.0 | BlueOak-1.0.0 |
| jackspeak | 3.4.3 | BlueOak-1.0.0 |
| lru-cache | 11.5.2 | BlueOak-1.0.0 |
| minimatch | 10.2.6 | BlueOak-1.0.0 |
| minipass | 7.1.3 | BlueOak-1.0.0 |
| package-json-from-dist | 1.0.1 | BlueOak-1.0.0 |
| path-scurry | 1.11.1, 2.0.2 | BlueOak-1.0.0 |
| language-subtag-registry | 0.3.23 | CC0-1.0 |
| mdn-data | 2.27.1 | CC0-1.0 |
| tslib | 2.8.1 | 0BSD |

The inventory was collected on macOS ARM64. Platform-specific packages can differ on Linux CI and must be evaluated by the same policy there. This is dependency metadata, not a full review of each package's license files or distribution obligations.

The remaining decision is whether to retain the original allowlist and replace these dependencies, or approve a documented expanded list after review. Until then, the licensing portion of F19 remains blocked on policy; it must not be marked passed or silently baselined as accepted risk.
