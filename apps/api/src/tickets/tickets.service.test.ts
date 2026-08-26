import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TicketsService, type CreateTicketDto } from './tickets.service.js'

const mockPool = {
  query: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tkt-001',
    user_id: 'user-1',
    subject: 'Test subject',
    body: 'Test body content',
    profile_id: null,
    related_entity_type: null,
    related_entity_id: null,
    priority: 'normal',
    status: 'open',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  }
}

const validDto: CreateTicketDto = {
  subject: 'Test subject',
  body: 'Test body content',
}

describe('TicketsService', () => {
  let service: TicketsService

  beforeEach(() => {
    service = new TicketsService()
    mockPool.query.mockReset()
  })

  describe('createTicket', () => {
    it('creates a ticket with required fields', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })

      const result = await service.createTicket('user-1', validDto)

      expect(result.id).toBe('tkt-001')
      expect(result.subject).toBe('Test subject')
      expect(result.body).toBe('Test body content')
      expect(result.priority).toBe('normal')
      expect(result.status).toBe('open')
      expect(result.userId).toBe('user-1')
    })

    it('creates a ticket with profile and related entity', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'prof-1' }] }) // profile exists
        .mockResolvedValueOnce({
          rows: [makeRow({
            priority: 'high',
            profile_id: 'prof-1',
            related_entity_type: 'order',
            related_entity_id: 'ord-001',
          })],
        })

      const result = await service.createTicket('user-1', {
        subject: 'Order issue',
        body: 'My order has a problem',
        profileId: 'prof-1',
        relatedEntityType: 'order',
        relatedEntityId: 'ord-001',
        priority: 'high',
      })

      expect(result.priority).toBe('high')
      expect(result.profileId).toBe('prof-1')
      expect(result.relatedEntityType).toBe('order')
      expect(result.relatedEntityId).toBe('ord-001')
    })

    it('throws 400 when subject is missing', async () => {
      await expect(
        service.createTicket('user-1', { subject: '', body: 'body' }),
      ).rejects.toThrow(/Subject is required/)
    })

    it('throws 400 when subject exceeds 200 characters', async () => {
      await expect(
        service.createTicket('user-1', { subject: 'x'.repeat(201), body: 'body' }),
      ).rejects.toThrow(/Subject must be 200 characters or fewer/)
    })

    it('throws 400 when body is missing', async () => {
      await expect(
        service.createTicket('user-1', { subject: 'subject', body: '' }),
      ).rejects.toThrow(/Body is required/)
    })

    it('throws 400 when body exceeds 10000 characters', async () => {
      await expect(
        service.createTicket('user-1', { subject: 'subject', body: 'x'.repeat(10001) }),
      ).rejects.toThrow(/Body must be 10,000 characters or fewer/)
    })

    it('throws 404 when profile does not belong to user', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.createTicket('user-1', { ...validDto, profileId: 'prof-other' }),
      ).rejects.toThrow(/Profile not found/)
    })
  })
})