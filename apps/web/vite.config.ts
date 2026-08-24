import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    // Route-level CSS/JS splitting — each route gets its own chunk
    inlineDynamicImports: false,
    // Content-hash filenames for CDN immutability (CDN-ready)
    assetsDir: 'assets',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: undefined, // let Vite handle per-entry splitting
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    // Output directory
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
  },
  ssr: {
    // NoExternal for monorepo workspace packages so they're bundled correctly
    noExternal: ['@barghsa/shared', '@barghsa/i18n', '@barghsa/ui'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})