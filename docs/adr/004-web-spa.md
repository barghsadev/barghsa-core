# ADR 004: retain the Vite SPA

Status: accepted by the project owner on 2026-09-07.

## Decision

Keep `apps/web` on Vite with TanStack Router and client-side React rendering. The owner explicitly chose to retain the Vite SPA and update requirements during the repair audit. This replaces the former TanStack Start/SSR requirement; it is not a claim of dependency incompatibility in current TanStack releases.

The production Node web server serves the HTML shell and static assets and drains active requests on shutdown. NestJS owns authorization, prices, financial writes and state transitions. Do not introduce a second business-logic implementation in the frontend server.

## Consequences and retained requirements

React content appears after browser JavaScript runs. Public metadata, discoverability and first-load performance must be evaluated for that behavior. There is no server-rendered React content to hydrate or flush. A future SSR migration requires a separate decision.

Route splitting, complete route payload budgets, immutable hashed assets, private API caching, CSP, Persian/English support, RTL, accessible loading/error states and graceful shutdown remain required. Language and direction must be established before the client app renders using persisted preferences and browser language detection. The architecture decision does not waive those checks or certify outstanding task acceptance.

Canonical task IDs stay unchanged. Queue and traceability text are regenerated from the updated requirements. Historical audit evidence retains its original revision and requirement hashes. No live assignment or scheduler is changed; an old assignment whose requirement digest differs must remain blocked for explicit recovery.
