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

function makeCommentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmt-001',
    ticket_id: 'tkt-001',
    author_id: 'user-1',
    body: 'Test comment body',
    visibility: 'public',
    created_at: new Date('2026-01-01T12:00:00Z'),
    updated_at: new Date('2026-01-01T12:00:00Z'),
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

  describe('listTickets', () => {
    it('returns paginated tickets for a user', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({ rows: [makeRow()] })

      const result = await service.listTickets('user-1')

      expect(result.data).toHaveLength(1)
      expect(result.data[0]!.id).toBe('tkt-001')
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(20)
      expect(result.totalPages).toBe(1)
    })

    it('filters by status', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({ rows: [makeRow({ status: 'open' })] })

      const result = await service.listTickets('user-1', { status: 'open' })

      expect(result.data).toHaveLength(1)
      expect(result.data[0]!.status).toBe('open')
      // Verify the status parameter was passed in the query
      const countCall = mockPool.query.mock.calls[0]!
      expect(countCall[1]).toContain('open')
    })

    it('supports search', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({ rows: [makeRow({ subject: 'Power outage report' })] })

      const result = await service.listTickets('user-1', { search: 'outage' })

      expect(result.data).toHaveLength(1)
      // The search parameter should be passed as ILIKE pattern (index 1, after userId)
      const countCall = mockPool.query.mock.calls[0]!
      expect(countCall[1]![1]).toBe('%outage%')
    })

    it('returns empty list when no tickets exist', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] })

      const result = await service.listTickets('user-1')

      expect(result.data).toHaveLength(0)
      expect(result.total).toBe(0)
      expect(result.totalPages).toBe(0)
    })

    it('respects page and limit options', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 50 }] })
        .mockResolvedValueOnce({ rows: Array.from({ length: 10 }, (_, i) => makeRow({ id: `tkt-${String(i + 1).padStart(3, '0')}` })) })

      const result = await service.listTickets('user-1', { page: 2, limit: 10 })

      expect(result.data).toHaveLength(10)
      expect(result.page).toBe(2)
      expect(result.limit).toBe(10)
      expect(result.totalPages).toBe(5)
    })
  })

  describe('getTicket', () => {
    it('returns a ticket by ID', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })

      const result = await service.getTicket('tkt-001', 'user-1')

      expect(result.id).toBe('tkt-001')
      expect(result.userId).toBe('user-1')
    })

    it('throws 404 when ticket does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.getTicket('tkt-999', 'user-1'),
      ).rejects.toThrow(/Ticket not found/)
    })

    it('throws 404 when ticket belongs to another user', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.getTicket('tkt-001', 'user-other'),
      ).rejects.toThrow(/Ticket not found/)
    })
  })

  describe('updateTicketStatus', () => {
    it('updates the ticket status (admin)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ status: 'in_progress' })] })

      const result = await service.updateTicketStatus('tkt-001', 'user-1', 'in_progress', true)

      expect(result.status).toBe('in_progress')
    })

    it('allows non-admin to reopen (set open)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ status: 'open' })] })

      const result = await service.updateTicketStatus('tkt-001', 'user-1', 'open', false)

      expect(result.status).toBe('open')
    })

    it('throws 403 when non-admin tries to change status to non-open', async () => {
      await expect(
        service.updateTicketStatus('tkt-001', 'user-1', 'resolved'),
      ).rejects.toThrow(/Only staff can change ticket status/)
    })

    it('throws 400 for invalid status', async () => {
      await expect(
        service.updateTicketStatus('tkt-001', 'user-1', 'invalid_status'),
      ).rejects.toThrow(/Invalid status/)
    })

    it('throws 404 when ticket does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.updateTicketStatus('tkt-999', 'user-1', 'resolved', true),
      ).rejects.toThrow(/Ticket not found/)
    })
  })

  describe('listComments', () => {
    it('returns public comments for a customer', async () => {
      // getTicket check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
      // comments query
      mockPool.query.mockResolvedValueOnce({ rows: [makeCommentRow()] })

      const result = await service.listComments('tkt-001', 'user-1', false)

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('cmt-001')
      expect(result[0]!.visibility).toBe('public')
    })

    it('returns all comments for an admin', async () => {
      // getTicket check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
      // comments query (no visibility filter)
      mockPool.query.mockResolvedValueOnce({
        rows: [
          makeCommentRow({ id: 'cmt-001', visibility: 'public' }),
          makeCommentRow({ id: 'cmt-002', visibility: 'internal', body: 'Staff note' }),
        ],
      })

      const result = await service.listComments('tkt-001', 'user-1', true)

      expect(result).toHaveLength(2)
    })

    it('filters internal comments for non-admin users', async () => {
      // getTicket check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
      // comments query with visibility filter
      mockPool.query.mockResolvedValueOnce({ rows: [makeCommentRow()] })

      const result = await service.listComments('tkt-001', 'user-1', false)

      expect(result).toHaveLength(1)
      // Verify the query filters by 'public'
      const queryCall = mockPool.query.mock.calls[1]!
      expect(queryCall[0]).toContain("visibility = 'public'")
    })

    it('throws 404 when ticket does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.listComments('tkt-999', 'user-1', false),
      ).rejects.toThrow(/Ticket not found/)
    })
  })

  describe('addComment', () => {
    it('adds a public comment to a ticket', async () => {
      // getTicket check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
      // insert
      mockPool.query.mockResolvedValueOnce({ rows: [makeCommentRow()] })

      const result = await service.addComment('tkt-001', 'user-1', 'This is a comment')

      expect(result.id).toBe('cmt-001')
      expect(result.body).toBe('Test comment body')
      expect(result.visibility).toBe('public')
    })

    it('adds an internal note (admin)', async () => {
      // getTicket check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] })
      // insert
      mockPool.query.mockResolvedValueOnce({ rows: [makeCommentRow({ visibility: 'internal' })] })

      const result = await service.addComment('tkt-001', 'user-1', 'Internal staff note', 'internal', true)

      expect(result.visibility).toBe('internal')
    })

    it('throws 403 when non-admin adds internal note', async () => {
      await expect(
        service.addComment('tkt-001', 'user-1', 'Staff note', 'internal'),
      ).rejects.toThrow(/Only staff can add internal notes/)
    })

    it('throws 400 when comment body is empty', async () => {
      await expect(
        service.addComment('tkt-001', 'user-1', ''),
      ).rejects.toThrow(/Comment body is required/)
    })

    it('throws 400 when comment body exceeds 10000 characters', async () => {
      await expect(
        service.addComment('tkt-001', 'user-1', 'x'.repeat(10001)),
      ).rejects.toThrow(/Comment body must be 10,000 characters or fewer/)
    })

    it('throws 404 when ticket does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.addComment('tkt-999', 'user-1', 'Comment on missing ticket'),
      ).rejects.toThrow(/Ticket not found/)
    })
  })

  describe('staffListTickets', () => {
    it('returns all tickets without user_id filter', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 2 }] })
        .mockResolvedValueOnce({ rows: [makeRow({ id: 'tkt-001' }), makeRow({ id: 'tkt-002', user_id: 'user-2' })] })

      const result = await service.staffListTickets()

      expect(result.data).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('filters by assignedTo', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({ rows: [makeRow({ assigned_to: 'staff-1' })] })

      const result = await service.staffListTickets({ assignedTo: 'staff-1' })

      expect(result.data).toHaveLength(1)
      const countCall = mockPool.query.mock.calls[0]!
      expect(countCall[1]![0]).toBe('staff-1')
    })

    it('filters by status', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({ rows: [makeRow({ status: 'resolved' })] })

      const result = await service.staffListTickets({ status: 'resolved' })

      expect(result.data).toHaveLength(1)
      expect(result.data[0]!.status).toBe('resolved')
    })

    it('supports search', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({ rows: [makeRow({ subject: 'Billing issue' })] })

      const result = await service.staffListTickets({ search: 'billing' })

      expect(result.data).toHaveLength(1)
      const countCall = mockPool.query.mock.calls[0]!
      expect(countCall[1]![0]).toBe('%billing%')
    })

    it('returns empty list when no tickets', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] })

      const result = await service.staffListTickets()

      expect(result.data).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('invalid status throws 400', async () => {
      await expect(
        service.staffListTickets({ status: 'invalid' }),
      ).rejects.toThrow(/Invalid status/)
    })
  })

  describe('staffGetTicket', () => {
    it('returns any ticket by ID', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ user_id: 'user-other' })] })

      const result = await service.staffGetTicket('tkt-001')

      expect(result.id).toBe('tkt-001')
      expect(result.userId).toBe('user-other')
    })

    it('throws 404 when ticket does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.staffGetTicket('tkt-999'),
      ).rejects.toThrow(/Ticket not found/)
    })
  })

  describe('staffAssignTicket', () => {
    it('assigns a ticket and transitions open to in_progress', async () => {
      // getTicket check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ status: 'open' })] })
      // update
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ assigned_to: 'staff-1', status: 'in_progress' })] })

      const result = await service.staffAssignTicket('tkt-001', 'staff-1')

      expect(result.assignedTo).toBe('staff-1')
      expect(result.status).toBe('in_progress')
    })

    it('assigns a ticket without changing non-open status', async () => {
      // getTicket check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ status: 'resolved' })] })
      // update
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ assigned_to: 'staff-1', status: 'resolved' })] })

      const result = await service.staffAssignTicket('tkt-001', 'staff-1')

      expect(result.assignedTo).toBe('staff-1')
      expect(result.status).toBe('resolved')
    })

    it('throws 404 when ticket does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.staffAssignTicket('tkt-999', 'staff-1'),
      ).rejects.toThrow(/Ticket not found/)
    })
  })

  describe('staffUpdateTicketStatus', () => {
    it('updates status of any ticket', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ status: 'closed' })] })

      const result = await service.staffUpdateTicketStatus('tkt-001', 'closed')

      expect(result.status).toBe('closed')
    })

    it('throws 400 for invalid status', async () => {
      await expect(
        service.staffUpdateTicketStatus('tkt-001', 'invalid'),
      ).rejects.toThrow(/Invalid status/)
    })

    it('throws 404 when ticket does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.staffUpdateTicketStatus('tkt-999', 'resolved'),
      ).rejects.toThrow(/Ticket not found/)
    })
  })

  describe('staffListComments', () => {
    it('returns all comments including internal', async () => {
      // staffGetTicket check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ user_id: 'user-other' })] })
      // comments
      mockPool.query.mockResolvedValueOnce({
        rows: [
          makeCommentRow({ id: 'cmt-001', visibility: 'public' }),
          makeCommentRow({ id: 'cmt-002', visibility: 'internal', body: 'Staff note' }),
        ],
      })

      const result = await service.staffListComments('tkt-001')

      expect(result).toHaveLength(2)
      expect(result[0]!.visibility).toBe('public')
      expect(result[1]!.visibility).toBe('internal')
    })

    it('throws 404 when ticket does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.staffListComments('tkt-999'),
      ).rejects.toThrow(/Ticket not found/)
    })
  })

  describe('staffAddComment', () => {
    it('adds a public comment to any ticket', async () => {
      // staffGetTicket check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ user_id: 'user-other' })] })
      // insert
      mockPool.query.mockResolvedValueOnce({ rows: [makeCommentRow({ author_id: 'staff-1' })] })

      const result = await service.staffAddComment('tkt-001', 'staff-1', 'Staff comment')

      expect(result.id).toBe('cmt-001')
      expect(result.authorId).toBe('staff-1')
    })

    it('adds an internal note', async () => {
      // staffGetTicket check
      mockPool.query.mockResolvedValueOnce({ rows: [makeRow({ user_id: 'user-other' })] })
      // insert
      mockPool.query.mockResolvedValueOnce({ rows: [makeCommentRow({ visibility: 'internal', author_id: 'staff-1' })] })

      const result = await service.staffAddComment('tkt-001', 'staff-1', 'Internal note', 'internal')

      expect(result.visibility).toBe('internal')
    })

    it('throws 400 when comment body is empty', async () => {
      await expect(
        service.staffAddComment('tkt-001', 'staff-1', ''),
      ).rejects.toThrow(/Comment body is required/)
    })

    it('throws 400 when comment body exceeds 10000 characters', async () => {
      await expect(
        service.staffAddComment('tkt-001', 'staff-1', 'x'.repeat(10001)),
      ).rejects.toThrow(/Comment body must be 10,000 characters or fewer/)
    })

    it('throws 404 when ticket does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })

      await expect(
        service.staffAddComment('tkt-999', 'staff-1', 'Comment on missing ticket'),
      ).rejects.toThrow(/Ticket not found/)
    })
  })
})