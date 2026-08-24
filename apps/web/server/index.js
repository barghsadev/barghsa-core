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
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const DIST_DIR = join(__dirname, '..', 'dist');
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

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
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/**
 * Try to serve a static file from dist.
 * Returns the file content and MIME type, or null if not found.
 */
async function serveFile(urlPath) {
  // Normalize path to prevent directory traversal
  const normalized = urlPath.split('?')[0].replace(/\.\.\//g, '');
  const filePath = join(DIST_DIR, normalized);

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

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';

  // Only handle GET and HEAD
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  // Try to serve the exact file
  const file = await serveFile(url);

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
  const index = await serveFile('/index.html');
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

server.listen(PORT, () => {
  console.log(`Barghsa web server listening on http://0.0.0.0:${PORT}`);
});