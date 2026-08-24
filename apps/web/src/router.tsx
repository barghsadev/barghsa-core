import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen.js'

// The router instance
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingMs: 100,
  defaultPendingMinMs: 500,
})

// Type-safe router for the app
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}