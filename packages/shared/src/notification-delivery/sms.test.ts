import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createSmsSender, prepareSmsMessage } from './sms.js'
let server: Server, endpoint: string, response: unknown = { status: 1, data: { messageId: 123 } }
const received: unknown[] = []
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
    received.push(JSON.parse(Buffer.concat(chunks).toString()))
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(response))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local endpoint')
  endpoint = `http://127.0.0.1:${address.port}`
})
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
function setup(count = 1) {
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes('security_rate_limit_counters') ? [{ count }] : [{ id: 'sms-provider', transport: 'smsir', config: {
    api_key: 'local-test-only', sender: '3000', throughput_limit: 2, template_mappings: [{ event_key: 'invoice.created', template_id: '42', variables: { amount: 'AMOUNT' } }],
  } }] }))
  const request = vi.fn<typeof fetch>(async (_url, options) => fetch(endpoint, options))
  return { pool: { query }, request }
}
it('uses only approved mapped variables and requires an actual provider receipt', async () => {
  const { pool, request } = setup()
  const message = await prepareSmsMessage(pool, '+989121234567', 'invoice.created', ['amount'], { amount: 5000, secret: 'not-sent' })
  expect(await createSmsSender(pool, request)(message)).toBe('123')
  expect(received.at(-1)).toEqual({ Mobile: '09121234567', TemplateId: 42, Parameters: [{ Name: 'AMOUNT', Value: '5000' }] })
  response = { status: 1, data: {} }
  await expect(createSmsSender(pool, request)(message)).rejects.toThrow('no receipt')
})
it('rejects missing/unapproved mapping data, quota exhaustion, changed providers and cancellation', async () => {
  const { pool, request } = setup(3)
  await expect(prepareSmsMessage(pool, '+989121234567', 'invoice.created', [], { amount: 5000 })).rejects.toThrow('not approved')
  await expect(prepareSmsMessage(pool, '+989121234567', 'invoice.created', ['amount'], {})).rejects.toThrow('incomplete')
  const message = await prepareSmsMessage(pool, '+989121234567', 'invoice.created', ['amount'], { amount: 5000 })
  await expect(createSmsSender(pool, request)(message)).rejects.toThrow('quota')
  await expect(createSmsSender(pool, request)({ ...message, providerId: 'old-provider' })).rejects.toThrow('reconciliation')
  await expect(createSmsSender(pool, request)(message, AbortSignal.abort())).rejects.toThrow()
  expect(request).not.toHaveBeenCalled()
})
