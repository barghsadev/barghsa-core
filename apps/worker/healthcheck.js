#!/usr/bin/env node
/**
 * Health check script for Docker HEALTHCHECK.
 * Exits 0 if the worker is responsive, 1 otherwise.
 * Checks the readiness endpoint, including required database connectivity.
 */

const http = require('node:http')

const PORT = process.env.WORKER_PORT ?? '9090'
const HOST = process.env.HOST ?? '127.0.0.1'

const req = http.get(`http://${HOST}:${PORT}/health/ready`, (res) => {
  let data = ''
  res.on('data', (chunk) => { data += chunk })
  res.on('end', () => {
    if (res.statusCode === 200) {
      try {
        const body = JSON.parse(data)
        process.exit(body.status === 'ok' ? 0 : 1)
      } catch {
        process.exit(1)
      }
    } else {
      process.exit(1)
    }
  })
})

req.on('error', () => process.exit(1))
req.setTimeout(5000, () => {
  req.destroy()
  process.exit(1)
})
