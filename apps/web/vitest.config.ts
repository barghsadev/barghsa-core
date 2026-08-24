import { createVitestConfig } from '../../packages/tsconfig/vitest.base.config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default createVitestConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})