import { describe, it, expect } from 'vitest'
import {
  DUE_AT_OVERRIDE_ERRORS,
  DUE_AT_OVERRIDE_EVENT,
  DUE_AT_OVERRIDE_PERMISSION,
  DUE_AT_OVERRIDE_REASON_MAX_LENGTH,
  DUE_AT_OVERRIDEABLE_STATES,
  buildDueAtOverrideSnapshot,
  isDueAtOverrideableState,
  parseDueAtOverrideBody,
  readDueAtOverrideSnapshot,
} from './due-at-override.js'

describe('dueAt staff override contract (T-04.1.03.03)', () => {
  describe('isDueAtOverrideableState', () => {
    it.each([...DUE_AT_OVERRIDEABLE_STATES])('allows %s', (state) => {
      expect(isDueAtOverrideableState(state)).toBe(true)
    })

    it.each(['Draft', 'Paid', 'Cancelled', 'PartiallyRefunded', 'Refunded'])(
      'rejects %s',
      (state) => {
        expect(isDueAtOverrideableState(state)).toBe(false)
      },
    )
  })

  describe('parseDueAtOverrideBody', () => {
    it('accepts camelCase dueAt + trimmed reason', () => {
      const parsed = parseDueAtOverrideBody({
        dueAt: '2026-09-15T08:00:00.000Z',
        reason: '  Customer requested an extension  ',
      })
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(parsed.value.dueAt.toISOString()).toBe('2026-09-15T08:00:00.000Z')
      expect(parsed.value.reason).toBe('Customer requested an extension')
    })

    it('accepts snake_case due_at', () => {
      const parsed = parseDueAtOverrideBody({
        due_at: '2026-09-01T00:00:00.000Z',
        reason: 'Holiday closure',
      })
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(parsed.value.dueAt.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    })

    it('rejects a missing/blank reason (customer-visible, required)', () => {
      const parsed = parseDueAtOverrideBody({
        dueAt: '2026-09-15T08:00:00.000Z',
        reason: '   ',
      })
      expect(parsed.ok).toBe(false)
      if (parsed.ok) return
      expect(parsed.issues).toContain(DUE_AT_OVERRIDE_ERRORS.BAD_REASON())
    })

    it('rejects a reason over the max length', () => {
      const parsed = parseDueAtOverrideBody({
        dueAt: '2026-09-15T08:00:00.000Z',
        reason: 'x'.repeat(DUE_AT_OVERRIDE_REASON_MAX_LENGTH + 1),
      })
      expect(parsed.ok).toBe(false)
    })

    it('rejects an invalid dueAt', () => {
      const parsed = parseDueAtOverrideBody({
        dueAt: 'not-a-date',
        reason: 'Extension',
      })
      expect(parsed.ok).toBe(false)
      if (parsed.ok) return
      expect(parsed.issues).toContain(DUE_AT_OVERRIDE_ERRORS.BAD_DUE_AT())
    })

    it('rejects a non-object body', () => {
      expect(parseDueAtOverrideBody(null).ok).toBe(false)
      expect(parseDueAtOverrideBody([]).ok).toBe(false)
      expect(parseDueAtOverrideBody('x').ok).toBe(false)
    })
  })

  describe('buildDueAtOverrideSnapshot / readDueAtOverrideSnapshot', () => {
    it('records the customer-visible reason and previous dueAt', () => {
      const snapshot = buildDueAtOverrideSnapshot({
        dueAt: new Date('2026-09-15T08:00:00.000Z'),
        previousDueAt: new Date('2026-08-08T10:00:00.000Z'),
        reason: 'Customer requested an extension',
        actorUserId: 'staff-1',
        overriddenAt: new Date('2026-08-02T12:00:00.000Z'),
      })
      expect(snapshot).toEqual({
        dueAt: '2026-09-15T08:00:00.000Z',
        previousDueAt: '2026-08-08T10:00:00.000Z',
        reason: 'Customer requested an extension',
        actorUserId: 'staff-1',
        overriddenAt: '2026-08-02T12:00:00.000Z',
        customerVisible: true,
      })
      expect(readDueAtOverrideSnapshot({ dueAtOverride: snapshot })).toEqual(snapshot)
    })

    it('returns null when metadata has no override', () => {
      expect(readDueAtOverrideSnapshot(null)).toBeNull()
      expect(readDueAtOverrideSnapshot({})).toBeNull()
      expect(readDueAtOverrideSnapshot({ due: { source: 'config' } })).toBeNull()
    })
  })

  it('exports the audit event and permission constants', () => {
    expect(DUE_AT_OVERRIDE_EVENT).toBe('invoice.due_at.override')
    expect(DUE_AT_OVERRIDE_PERMISSION).toBe('admin:finance:invoices:override-due-at')
  })
})
