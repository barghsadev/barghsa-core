import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

/**
 * @barghsa/web Vitest config
 *
 * - jsdom environment for React component tests
 * - Aliases match the Vite runtime config
 * - A global setup file at src/test/setup.ts can be populated per-project
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: false,
    typecheck: { enabled: false },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})