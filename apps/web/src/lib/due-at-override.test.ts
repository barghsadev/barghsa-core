import { describe, it, expect } from 'vitest'
import {
  datetimeLocalToIso,
  isInvoiceUuid,
  isoToDatetimeLocal,
  lookupMatchesLoadedInvoice,
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

  it('treats a lookup as bound only when it matches the loaded invoice id', () => {
    const loaded = '11111111-1111-7111-8111-111111111111'
    expect(lookupMatchesLoadedInvoice(loaded, loaded)).toBe(true)
    expect(lookupMatchesLoadedInvoice(`  ${loaded}  `, loaded)).toBe(true)
    expect(
      lookupMatchesLoadedInvoice('22222222-2222-7222-8222-222222222222', loaded),
    ).toBe(false)
    expect(lookupMatchesLoadedInvoice('', loaded)).toBe(false)
  })
})
