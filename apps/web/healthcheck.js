#!/usr/bin/env node
/**
 * Health check script for Docker HEALTHCHECK.
 * Exits 0 if the server is responsive, 1 otherwise.
 */

import http from 'node:http'

const PORT = process.env['PORT'] ?? '3000'
const HOST = process.env['HOST'] ?? '127.0.0.1'

const req = http.get(`http://${HOST}:${PORT}/`, (res) => {
  process.exit(res.statusCode === 200 ? 0 : 1)
})

req.on('error', () => process.exit(1))
req.setTimeout(5000, () => {
  req.destroy()
  process.exit(1)
})
