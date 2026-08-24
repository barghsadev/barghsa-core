import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { resolve } from 'path'

/**
 * Vite plugin: apply immutable Cache-Control only to content-hashed assets.
 * index.html and other unhashed resources serve with no-cache so clients
 * always fetch the latest entry point on deployment.
 */
function immutableAssetsPlugin(): ReturnType<typeof defineConfig>['plugins'][0] {
  const IMMUTABLE_PATTERN = /\/assets\/.+-[a-zA-Z0-9_-]{8,}\./
  return {
    name: 'immutable-assets',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && IMMUTABLE_PATTERN.test(req.url)) {
          res.setHeader('Cache-Control', 'public, immutable, max-age=31536000')
        } else if (req.url && !req.url.startsWith('/api')) {
          // index.html and other unhashed resources — revalidate on every deploy
          res.setHeader('Cache-Control', 'no-cache, must-revalidate')
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      autoCodeSplitting: false,
    }),
    react(),
    immutableAssetsPlugin(),
  ],
  // CDN base URL — set CDN_URL for production builds so assets resolve via CDN
  base: process.env['CDN_URL'] ? process.env['CDN_URL'] : '/',
  build: {
    // Route-level CSS/JS splitting — each route gets its own chunk
    // autoCodeSplitting in TanStack Router handles actual per-route lazy loading
    inlineDynamicImports: false,
    // Content-hash filenames for CDN immutability (CDN-ready)
    assetsDir: 'assets',
    cssCodeSplit: true,
    // Generate build manifest for CDN cache invalidation
    manifest: true,
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