import { createVitestConfig } from '../../packages/tsconfig/vitest.base.config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'node:fs';

export default createVitestConfig({
  define: {
    __BARGHSA_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')).version
    ),
  },
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
});
