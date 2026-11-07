import { createRouter } from '@tanstack/react-router';
import { lazy } from 'react';
import { routeTree } from './routeTree.gen.js';

// The router instance
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingMs: 100,
  defaultPendingMinMs: 500,
  defaultErrorComponent: lazy(() => import('./components/RouteErrorBoundary.js')),
  defaultNotFoundComponent: lazy(() =>
    import('./components/RouteErrorBoundary.js').then((module) => ({
      default: module.RouteNotFound,
    }))
  ),
  defaultPendingComponent: lazy(() =>
    import('./components/RouteSkeleton.js').then((module) => ({ default: module.RouteSkeleton }))
  ),
});

// Type-safe router for the app
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
