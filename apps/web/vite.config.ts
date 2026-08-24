import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      autoCodeSplitting: false,
    }),
    react(),
  ],
  build: {
    // Route-level CSS/JS splitting — each route gets its own chunk
    // autoCodeSplitting in TanStack Router handles actual per-route lazy loading
    inlineDynamicImports: false,
    // Content-hash filenames for CDN immutability (CDN-ready)
    assetsDir: 'assets',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: undefined, // let TanStack Router handle route-based splitting
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