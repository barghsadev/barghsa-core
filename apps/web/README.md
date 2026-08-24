# @barghsa/web — Barghsa Web Application

## Build Pipeline

This app uses **Vite** with **TanStack Router** for client-side rendering.

- **Vite** handles bundling, HMR, and production builds
- **TanStack Router** provides file-route-based routing with automatic code splitting
- **@tanstack/router-plugin** Vite plugin generates route trees and enables per-route lazy loading
- Build output: `dist/` with hashed asset filenames for CDN immutability

### TanStack Start

The task name references "TanStack Start" because `@tanstack/start` is the SSR framework from the TanStack team. However, the current `@tanstack/start` (latest v1.120.20) has unresolved transitive dependency incompatibilities — its `^`-range dependencies (`@tanstack/router-plugin`, `@tanstack/router-generator`) resolve to newer versions that break its import contracts. This is a known limitation of the pre-v1.0 TanStack ecosystem.

**Current approach:** Vite + TanStack Router directly. This matches the same build architecture (Vite-based bundling, TanStack Router routing, route-level code splitting) without the broken dependency chain. When `@tanstack/start` receives package updates resolving the versioning, it can be swapped in with minimal changes — the route structure and Vite config are compatible.

### Scripts

| Script | Description |
|--------|-------------|
| `dev` | Start Vite dev server |
| `build` | Production build to `dist/` |
| `preview` | Preview production build |
| `typecheck` | TypeScript type checking |