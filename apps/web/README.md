# @barghsa/web — Barghsa Web Application

## Build Pipeline

This app uses **Vite** with **TanStack Router** for client-side rendering.

- **Vite** handles bundling, HMR, and production builds
- **TanStack Router** provides file-route-based routing with automatic code splitting
- **@tanstack/router-plugin** Vite plugin generates route trees and enables per-route lazy loading
- Build output: `dist/` with hashed asset filenames for CDN immutability

### Architecture decision

The project owner approved retaining Vite SPA on 2026-09-07. [ADR 004](../../docs/adr/004-web-spa.md) records the decision and its limits. TanStack Start and server-side React rendering are not required by the updated canonical requirements.

The Node web server serves the HTML shell and static assets. NestJS remains authoritative for business operations. Initial content renders in the browser; public discoverability and first-load performance need measurement under that architecture. A future rendering-framework migration requires its own decision and validation.

### Scripts

| Script      | Description                 |
| ----------- | --------------------------- |
| `dev`       | Start Vite dev server       |
| `build`     | Production build to `dist/` |
| `preview`   | Preview production build    |
| `typecheck` | TypeScript type checking    |
