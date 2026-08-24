import { defineWorkspace } from 'vitest/config'

/**
 * Vitest workspace definition.
 *
 * Each workspace member (package/app) loads its own vitest.config.ts
 * (or vite.config.ts as fallback).  Directories without a vitest config
 * are silently skipped.
 *
 * @see https://vitest.dev/guide/workspace
 */
export default defineWorkspace([
  'packages/*',
  'apps/*',
])