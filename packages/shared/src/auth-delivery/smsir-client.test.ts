import { expect, it, vi } from 'vitest'
import { getSmsirCredit, sendSmsirVerification } from './smsir-client.js'

it('uses the provider request contract and requires a successful receipt', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 1, data: { messageId: 123 } })))
  expect(await sendSmsirVerification('key', 'https://api.sms.ir', '+989121234567', '12345', [{ name: 'CODE', value: '123456' }], request)).toBe('123')
  expect(request.mock.calls[0]![0]).toBe('https://api.sms.ir/v1/send/verify')
  expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ Mobile: '09121234567', TemplateId: 12345, Parameters: [{ Name: 'CODE', Value: '123456' }] })
  for (const body of [{}, { status: 1, data: {} }, { status: 0, data: { messageId: 123 } }]) {
    request.mockResolvedValueOnce(new Response(JSON.stringify(body)))
    await expect(sendSmsirVerification('key', 'https://api.sms.ir', '09121234567', '12345', [], request)).rejects.toThrow()
  }
})

it('rejects empty or failed credit responses instead of enabling a broken provider', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ status: 1, data: 0 })))
  expect(await getSmsirCredit('key', 'https://api.sms.ir', request)).toBe(0)
  for (const body of [{}, { status: 0, data: 100 }, { status: 1, data: '100' }]) {
    request.mockResolvedValueOnce(new Response(JSON.stringify(body)))
    await expect(getSmsirCredit('key', 'https://api.sms.ir', request)).rejects.toThrow()
  }
})
