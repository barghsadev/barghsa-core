import { describe, it, expect } from 'vitest'
import {
  datetimeLocalToIso,
  isInvoiceUuid,
  isoToDatetimeLocal,
} from './due-at-override.js'

describe('dueAt override UI helpers (T-04.1.03.03)', () => {
  it('accepts a UUID invoice id', () => {
    expect(isInvoiceUuid('11111111-1111-7111-8111-111111111111')).toBe(true)
    expect(isInvoiceUuid(' not-a-uuid ')).toBe(false)
    expect(isInvoiceUuid('')).toBe(false)
  })

  it('round-trips ISO through datetime-local', () => {
    const iso = '2026-09-15T08:00:00.000Z'
    const local = isoToDatetimeLocal(iso)
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    const back = datetimeLocalToIso(local)
    expect(back).toBeTruthy()
    expect(new Date(back!).getTime()).toBe(new Date(iso).getTime())
  })

  it('returns empty/null for invalid values', () => {
    expect(isoToDatetimeLocal(null)).toBe('')
    expect(isoToDatetimeLocal('nope')).toBe('')
    expect(datetimeLocalToIso('')).toBeNull()
    expect(datetimeLocalToIso('not-a-date')).toBeNull()
  })
})
