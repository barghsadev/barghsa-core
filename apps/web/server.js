#!/usr/bin/env node
/**
 * Production static file server for @barghsa/web.
 *
 * Serves the built SPA from `./dist/` with:
 *  - Immutable caching for content-hashed assets
 *  - SPA fallback (index.html) for non-file routes
 *  - Security headers
 *  - Headers matching the Vite config's immutable assets pattern
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, 'dist')
const PORT = parseInt(process.env['PORT'] ?? '3000', 10)

const HOST = process.env['HOST'] ?? '0.0.0.0'

// Content-hashed asset pattern (matches vite.config.ts)
const IMMUTABLE_PATTERN = /\/assets\/.+-[a-zA-Z0-9_-]{8,}\./

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/octet-stream',
}

const server = http.createServer((req, res) => {
  // Normalize URL
  let url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  let filePath = path.join(DIST_DIR, url.pathname === '/' ? 'index.html' : url.pathname)

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

  if (IMMUTABLE_PATTERN.test(url.pathname)) {
    res.setHeader('Cache-Control', 'public, immutable, max-age=31536000')
  } else if (url.pathname.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000')
  } else {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate')
  }

  // Serve file or fallback to SPA index.html
  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      serveFile(filePath, res)
    } else {
      // SPA fallback: serve index.html for client-side routing
      const indexPath = path.join(DIST_DIR, 'index.html')
      fs.stat(indexPath, (err2) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not Found')
          return
        }
        res.setHeader('Cache-Control', 'no-cache, must-revalidate')
        serveFile(indexPath, res)
      })
    }
  })
})

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Internal Server Error')
      return
    }
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
}

server.listen(PORT, HOST, () => {
  console.log(`[@barghsa/web] Production server listening on http://${HOST}:${PORT}`)
})
