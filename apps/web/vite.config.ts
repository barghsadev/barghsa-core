import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import { resolve } from 'path';
import { isAuthEntryPath } from './entry-routes.js';

/**
 * Vite plugin: apply immutable Cache-Control only to content-hashed assets.
 * index.html and other unhashed resources serve with no-cache so clients
 * always fetch the latest entry point on deployment.
 */
function immutableAssetsPlugin(): ReturnType<typeof defineConfig>['plugins'][0] {
  const IMMUTABLE_PATTERN = /\/assets\/.+-[a-zA-Z0-9_-]{8,}\./;
  return {
    name: 'immutable-assets',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && isAuthEntryPath(req.url)) req.url = '/auth/index.html';
        if (req.url && IMMUTABLE_PATTERN.test(req.url)) {
          res.setHeader('Cache-Control', 'public, immutable, max-age=31536000');
        } else if (req.url && !req.url.startsWith('/api')) {
          // index.html and other unhashed resources — revalidate on every deploy
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const authEntry = mode === 'auth';
  const base = process.env['CDN_URL'] || '/';
  return {
    define: { __BARGHSA_AUTH_ENTRY__: JSON.stringify(authEntry) },
    server: {
      host: process.env['WEB_HOST'] || 'localhost',
      port: Number(process.env['WEB_PORT'] || 3000),
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${process.env['PORT'] || 4000}`,
          changeOrigin: false,
        },
      },
    },
    plugins: [
      TanStackRouterVite({
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
        autoCodeSplitting: true,
        codeSplittingOptions: {
          splitBehavior: ({ routeId }) =>
            !authEntry &&
            [
              '/_app',
              '/_app/electricity/',
              '/_app/electricity/order',
              '/_app/savings',
              '/_app/wallet',
            ].includes(routeId)
              ? []
              : undefined,
        },
      }),
      react(),
      tailwindcss(),
      immutableAssetsPlugin(),
    ],
    // CDN base URL — set CDN_URL for production builds so assets resolve via CDN
    base: authEntry ? base.replace(/\/?$/, '/') + 'auth/' : base,
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
          // Short URLs reduce the shared preload map as the route inventory grows.
          chunkFileNames: 'assets/c-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
      // Output directory
      outDir:
        (process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'dist-coverage' : 'dist') +
        (authEntry ? '/auth' : ''),
      sourcemap: process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'hidden' : false,
      minify: 'terser',
      terserOptions: { ecma: 2020, compress: { passes: 2 } },
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
  };
});
