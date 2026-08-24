import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    typecheck: { enabled: false },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
})