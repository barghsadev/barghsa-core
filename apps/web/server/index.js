// @ts-check
/**
 * Minimal production static file server for the Barghsa web SPA.
 *
 * Serves the built Vite output from `dist/` with:
 * - Immutable Cache-Control for content-hashed assets (match vite.config.ts)
 * - SPA fallback: all non-file requests serve index.html (client-side routing)
 * - No external dependencies — uses only Node.js built-in modules
 *
 * Port is read from the `PORT` environment variable (default 3000).
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const DEFAULT_DIST_DIR = resolve(__dirname, '..', 'dist');

/** Content-hashed asset pattern matching vite.config.ts */
const IMMUTABLE_PATTERN = /\/assets\/.+-[a-zA-Z0-9_-]{8,}\./;

/** MIME types for common static assets */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.csv': 'text/csv',
  '.map': 'application/json',
};

/**
 * Resolve and validate a URL path against the dist directory.
 * Returns the absolute file path, or null if the request escapes the dist
 * directory (defends against directory traversal).
 */
function resolveDistPath(distDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const filePath = resolve(distDir, '.' + decoded);
  // Ensure the resolved path stays within the dist directory
  if (filePath !== distDir && !filePath.startsWith(distDir + sep)) {
    return null;
  }
  return filePath;
}

/**
 * Try to serve a static file from dist.
 * Returns the file content and MIME type, or null if not found.
 */
async function serveFile(distDir, urlPath) {
  const filePath = resolveDistPath(distDir, urlPath);
  if (!filePath) return null;

  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return null;
    const content = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    return { content, contentType };
  } catch {
    return null;
  }
}

/**
 * Create a configured HTTP server.
 * @param {object} [options]
 * @param {string} [options.distDir] Directory to serve (defaults to ../dist)
 * @returns {import('node:http').Server}
 */
export function createStaticServer(options = {}) {
  const distDir = resolve(options.distDir ?? DEFAULT_DIST_DIR);

  return createServer(async (req, res) => {
    const url = req.url ?? '/';

    // Only handle GET and HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    // Try to serve the exact file
    const file = await serveFile(distDir, url);

    if (file) {
      const cacheControl = IMMUTABLE_PATTERN.test(url)
        ? 'public, immutable, max-age=31536000'
        : 'no-cache, must-revalidate';

      res.writeHead(200, {
        'Content-Type': file.contentType,
        'Content-Length': file.content.length,
        'Cache-Control': cacheControl,
      });

      if (req.method === 'GET') {
        res.end(file.content);
      } else {
        res.end();
      }
      return;
    }

    // SPA fallback — serve index.html for client-side routing
    const index = await serveFile(distDir, '/index.html');
    if (index) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': index.content.length,
        'Cache-Control': 'no-cache, must-revalidate',
      });

      if (req.method === 'GET') {
        res.end(index.content);
      } else {
        res.end();
      }
      return;
    }

    // 404 — nothing at all
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });
}

// ── Auto-start when run directly (Docker CMD) ─────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
  const server = createStaticServer();
  server.listen(PORT, () => {
    process.stderr.write(`Barghsa web server listening on http://0.0.0.0:${PORT}\n`);
  });
}