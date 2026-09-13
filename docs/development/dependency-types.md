# Strict dependency declarations

All runtime projects inherit `skipLibCheck: false` from the shared TypeScript base. API, worker, web and DB must not restore local overrides. `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` remain enabled.

The pinned patches in `package.json` repair declarations only; no dependency JavaScript changes:

- Drizzle 0.45.2: restore runtime `getSQL` and SingleStore generated-column methods stripped from declarations; preserve the actual generated `always` discriminant; declare runtime role fields and their possible `undefined` values; remove private `session`/`config` keys from public set-operation exclusions. ESM and CommonJS declarations receive matching repairs. The upstream [strict-check issue](https://github.com/drizzle-team/drizzle-orm/issues/5187) describes the same missing-method failure family. Do not weaken `SQLWrapper` or column/result inference.
- Drizzle's declarations import Gel and MySQL types even for this PostgreSQL application. Exact `gel@2.2.0` and `mysql2@3.24.4` package extensions resolve those imports without fake ambient modules. This adds no application database adapter.
- Gel 2.2.0: obtain the fetch input from the host's `fetch` signature instead of a browser-only `RequestInfo` global. Node projects retain their server-only libraries.
- TanStack router-core 1.171.27: restore `__beforeLoadContext` from the shipped `src/Matches.ts`; published SSR declarations already reference it.
- Vite 6.4.3: align three plugin-hook `ssr` options with Rollup's explicit-undefined contract. Infer browser Worker from `globalThis`; it remains unavailable in a server-only type environment.

The shared table factory has an explicit `PgTableWithColumns`/`BuildColumns` return type, preserving literal table names and inferred insert/select types. This avoids invalid emitted references to out-of-scope type parameters in downstream consumers.

For updates, inspect the upstream declarations and remove each patch once its repair is present. Regenerate the lockfile and run a frozen install; patch configuration alone is insufficient proof that the lockfile uses it. Rebuild DB declarations before strict API/worker checks. Run the base-table type/runtime checks and affected builds, then the normal final regression gates. Keep numeric budgets, coverage floors and Node engine checks unchanged.
