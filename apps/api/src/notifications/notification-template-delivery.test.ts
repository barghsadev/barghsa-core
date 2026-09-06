import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationTemplateService } from './notification-template.service.js'
import type { NotificationsService } from './notifications.service.js'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@barghsa/db', () => ({ getDbPool: () => ({ query }) }))

beforeEach(() => { query.mockReset(); query.mockResolvedValue({ rows: [] }) })

function service(channel: 'email' | 'sms' | 'in_app') {
  const create = vi.fn().mockResolvedValue({ id: 'inbox-test' })
  const instance = new NotificationTemplateService({ create } as unknown as NotificationsService)
  vi.spyOn(instance, 'getById').mockResolvedValue({ id: 'template', eventKey: 'invoice.created', channel,
    subject: 'Invoice', bodyTemplate: 'Test body', variables: [] } as never)
  return { instance, create }
}

describe('truthful notification template tests', () => {
  it.each(['email', 'sms'] as const)('refuses to mark %s delivered through the inbox', async channel => {
    const { instance, create } = service(channel)
    await expect(instance.testSend('template', 'staff')).rejects.toMatchObject({ status: 503 })
    expect(create).not.toHaveBeenCalled()
    expect(query.mock.calls.some(([sql]) => sql.includes("last_test_status = 'delivered'"))).toBe(false)
    expect(query.mock.calls.some(([sql]) => sql.includes("last_test_status = 'failed'"))).toBe(true)
    const audit = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_log'))
    expect(JSON.parse(audit![1][3])).toMatchObject({ status: 'failed', destinationKind: channel, deliveredTo: null })
  })
  it('still delivers an in-app test to the acting staff inbox', async () => {
    const { instance, create } = service('in_app')
    expect(await instance.testSend('template', 'staff')).toEqual({ ok: true, destination: 'in_app', lastTestStatus: 'delivered' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'staff' }))
  })
  it.each([undefined, 'production', 'staging', 'preview'])('rejects test allowlists in %s', NODE_ENV => {
    expect(NotificationTemplateService.isDestinationAllowed([], 'test@example.test', { ...(NODE_ENV ? { NODE_ENV } : {}), TEST_SEND_ALLOWLIST: 'test@example.test' })).toBe(false)
  })
  it.each(['test', 'development'])('permits explicit %s allowlists and own verified contacts', NODE_ENV => {
    expect(NotificationTemplateService.isDestinationAllowed([], 'test@example.test', { NODE_ENV, TEST_SEND_ALLOWLIST: 'test@example.test' })).toBe(true)
    expect(NotificationTemplateService.isDestinationAllowed(['OWN@example.test'], 'own@example.test', { NODE_ENV: 'production' })).toBe(true)
  })
})
