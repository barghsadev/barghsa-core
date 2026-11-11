import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import { dirname, resolve } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { isAuthEntryPath } from './entry-routes.js';
import { addEnvironmentIndicator } from './environment-indicator.js';

const version: string = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf8')
).version;
function releaseMetadataPlugin() {
  return {
    name: 'release-metadata',
    generateBundle() {
      let commit = process.env['BARGHSA_RELEASE_SHA'] ?? null;
      if (!commit) {
        try {
          commit = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: __dirname,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim();
        } catch {
          // Development builds outside Git have no deployment identity.
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'release.json',
        source: JSON.stringify({ version, commit }) + '\n',
      });
    },
  } satisfies import('vite').Plugin;
}

function distributionNoticesPlugin(): import('vite').Plugin {
  const uiRoot = resolve(__dirname, '../../packages/ui');
  const requireFromUi = createRequire(resolve(uiRoot, 'package.json'));
  const requireFromWeb = createRequire(resolve(__dirname, 'package.json'));
  return {
    name: 'distribution-notices',
    generateBundle() {
      for (const [name, path] of [
        ['Vazirmatn-OFL.txt', resolve(uiRoot, 'src/fonts/vazirmatn-OFL.txt')],
        ['Inter-OFL.txt', requireFromUi.resolve('@fontsource-variable/inter/LICENSE')],
        [
          'DOMPurify-Apache-2.0.txt',
          resolve(dirname(requireFromWeb.resolve('dompurify')), '../LICENSE'),
        ],
      ]) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/licenses/${name}`,
          source: readFileSync(path),
        });
      }
    },
  };
}

function browserLicenseInventory(authEntry: boolean): import('vite').Plugin {
  return {
    name: 'browser-license-inventory',
    writeBundle(_options, bundle) {
      const output = process.env['BARGHSA_LICENSE_INVENTORY_DIR'];
      if (!output) return;
      const packages = new Map<string, { name: string; version: string; license: string | null }>();
      const roots = new Set<string>();
      const collect = (rawId: string) => {
        const id = rawId.replace(/^\0+/, '').replaceAll('\\', '/').split('?')[0]!;
        const marker = '/node_modules/';
        const index = id.lastIndexOf(marker);
        if (index === -1) return;
        const start = index + marker.length;
        const [namespace, scopedName] = id.slice(start).split('/');
        const name = namespace?.startsWith('@') ? `${namespace}/${scopedName}` : namespace;
        if (!name) throw new Error('Missing bundled package name');
        const root = id.slice(0, start + name.length);
        if (roots.has(root)) return;
        const metadata = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
          name?: unknown;
          version?: unknown;
          license?: unknown;
        };
        if (typeof metadata.name !== 'string' || typeof metadata.version !== 'string') {
          throw new Error(`Incomplete metadata for bundled package ${name}`);
        }
        roots.add(root);
        const entry = {
          name: metadata.name,
          version: metadata.version,
          license: typeof metadata.license === 'string' ? metadata.license : null,
        };
        packages.set(JSON.stringify(entry), entry);
      };
      for (const item of Object.values(bundle)) {
        if (item.type === 'asset') {
          for (const path of item.originalFileNames) collect(path);
        } else {
          for (const [id, module] of Object.entries(item.modules)) {
            if (module.renderedLength || /\.css(?:\?|$)/.test(id)) collect(id);
          }
        }
      }
      if (packages.size === 0) throw new Error('Browser package inventory is empty');
      mkdirSync(output, { recursive: true });
      const shell = authEntry ? 'auth' : 'app';
      writeFileSync(
        resolve(output, `${shell}.json`),
        JSON.stringify({ shell, packages: [...packages.values()] }, null, 2) + '\n'
      );
    },
  };
}

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
    define: {
      __BARGHSA_AUTH_ENTRY__: JSON.stringify(authEntry),
      __BARGHSA_VERSION__: JSON.stringify(version),
    },
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
      {
        name: 'development-environment-indicator',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use((_request, response, next) => {
            response.setHeader('X-Environment', 'development');
            next();
          });
        },
        transformIndexHtml: (html) => addEnvironmentIndicator(html, 'development'),
      },
      TanStackRouterVite({
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
        autoCodeSplitting: true,
        codeSplittingOptions: {
          splitBehavior: ({ routeId }) =>
            !authEntry &&
            ['/_app', '/_app/electricity/', '/_app/electricity/order', '/_app/savings'].includes(
              routeId
            )
              ? [['errorComponent'], ['pendingComponent']]
              : undefined,
        },
      }),
      react(),
      tailwindcss(),
      immutableAssetsPlugin(),
      releaseMetadataPlugin(),
      distributionNoticesPlugin(),
      browserLicenseInventory(authEntry),
    ],
    // CDN base URL — set CDN_URL for production builds so assets resolve via CDN
    base: authEntry ? base.replace(/\/?$/, '/') + 'auth/' : base,
    build: {
      // Route-level CSS/JS splitting — each route gets its own chunk
      // autoCodeSplitting in TanStack Router handles actual per-route lazy loading
      inlineDynamicImports: false,
      modulePreload: {
        // A failed modulepreload can survive a document reload in WebKit (bug 270357).
        resolveDependencies: (file, dependencies) =>
          file.startsWith('assets/p-') ? [] : dependencies,
      },
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
          chunkFileNames: ({ facadeModuleId }) =>
            facadeModuleId?.endsWith('/src/components/ProfileChoices.tsx')
              ? 'assets/p-[hash].js'
              : 'assets/c-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
      // Output directory
      outDir:
        (process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'dist-coverage' : 'dist') +
        (authEntry ? '/auth' : ''),
      sourcemap: process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'hidden' : false,
      // Coverage needs original statement boundaries; production remains minified.
      minify: process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? false : 'terser',
      terserOptions: { ecma: 2020, compress: { passes: 2 } },
    },
    ssr: {
      // NoExternal for monorepo workspace packages so they're bundled correctly
      noExternal: ['@barghsa/shared', '@barghsa/i18n', '@barghsa/ui'],
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
        ...(authEntry
          ? { './routeTree.gen.js': resolve(__dirname, './src/routeTree.auth.ts') }
          : {}),
      },
    },
  };
});
