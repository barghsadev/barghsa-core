# Dependency repair review

Baseline: `3a9cce7`, scanned on 2026-09-07 with `pnpm audit --json`. The raw result is saved in `dependency-scan-baseline-3a9cce7.json`. The scan reports five high and seven moderate vulnerability occurrences. This is package-version evidence, not proof that every advisory is reachable through the application.

| Dependency path | Finding | Planned repair |
| --- | --- | --- |
| Database package → drizzle-orm 0.40.1 | High: SQL identifier escaping | Upgrade to patched 0.45.2 and verify compilation and migrated database tests. |
| Database package → drizzle-kit → esbuild | Moderate: development server cross-origin access | Upgrade the migration tool and inspect its deprecated loader dependency. |
| API → SWC CLI → downloader → file-type | Two moderate parser/denial-of-service findings | Upgrade the CLI to a release using the patched downloader chain. |
| API/database → @types/uuid → uuid 10 | Moderate: UUID output buffer handling | Remove the obsolete type stub; the installed UUID 14 package supplies its types. |
| Root → unused size-limit preset → nanoid/extract-zip | Three high nanoid advisories and one high archive-extraction advisory | Remove the unused CLI/preset. The actual route-budget gate uses the Vite manifest and remains required. |
| API → Express → qs 6.15.3 | Two moderate request-parser denial-of-service findings | Resolve to patched 6.16 or later within Express's supported range. |

Drizzle's maintainer identifies 0.45.2 as the escaping fix. The affected path requires attacker-controlled identifier or alias construction. Static schema names alone do not establish exploitability. [Maintainer release](https://github.com/drizzle-team/drizzle-orm/releases/tag/0.45.2), [advisory](https://github.com/advisories/GHSA-gpj5-g38j-94v9).

## Implemented changes awaiting validation

Pinned Drizzle ORM 0.45.2, Drizzle Kit 0.31.10 and SWC CLI 0.8.1. Removed both unused size-limit packages and both obsolete UUID type stubs. The route-budget script and its committed budgets remain in CI.

Two narrowly selected dependency overrides are recorded in the root manifest:

- `qs@<6.16.0` resolves to 6.16.0, within Express 5.2.1's declared `^6.14.0` range.
- `drizzle-kit@0.31.10>@esbuild-kit/esm-loader` is removed. Inspection of that exact installed CLI and API bundle found no reference to the old loader; its configuration loader registers tsx. The old package is deprecated as merged into tsx. The override targets this exact Drizzle Kit version so a future tool upgrade requires another review. pnpm supports removing unused dependencies with `-`. [pnpm 10 override documentation](https://pnpm.io/10.x/settings#overrides).

The first scan after direct upgrades reported zero high findings and three moderate findings. The final overrides address those remaining qs/esbuild paths. CI now runs `pnpm audit --audit-level=high --json` and uploads its report, including failed runs. The audit command's nonzero exit is not suppressed. This implements the dependency scan only; secret scanning, SAST, licensing and changed-code coverage remain separate F19 work.

The compiler's optional watch dependency also changed from Chokidar 4 to 5. A version-scoped package extension supplies Chokidar 5 directly to SWC CLI, leaving Nest/Angular tooling on its own Chokidar 4 dependency. A temporary source-file smoke check verified both initial watch compilation and recompilation after editing the file. A broad application-level Chokidar 5 dependency was rejected during review because it conflicted with Angular's Chokidar 4 peer.

The production build, root type checks, API contract comparison, bundle budgets and Drizzle Kit journal/configuration check passed. The first database suite had 535 passing and 32 failing tests: every failure retained the expected PostgreSQL rejection, but Drizzle now wraps that error under `cause`. Updated only assertions that call Drizzle; raw-pool assertions still inspect the native PostgreSQL error. Constraint codes and message assertions remain intact.

## Final regression results

- Dependency audit: zero advisories across 1,284 dependencies. Raw report: `dependency-scan-repaired.json`.
- API: 2,871 tests passed across 224 files, including the real migrated application and authorization/financial negative cases.
- Database: all 567 tests passed across 78 files after adapting Drizzle error assertions, including clean and upgrade migrations, seed restrictions and financial constraints.
- Production build, root types, contract comparison, route budgets, lint and formatting passed.
- Drizzle Kit configuration/journal check passed with the obsolete loader absent.
- SWC watch compiled a temporary TypeScript source, observed an edit and rebuilt the changed value.

No accepted-risk exception was needed for the dependency advisories. This is a point-in-time scan of the locked dependency set, not a complete security review or completion of F19.
