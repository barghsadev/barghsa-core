import { describe, it, expect } from 'vitest';
import {
  datetimeLocalToIso,
  isInvoiceUuid,
  isoToDatetimeLocal,
  lookupMatchesLoadedInvoice,
} from './due-at-override.js';

describe('dueAt override UI helpers (T-04.1.03.03)', () => {
  it('accepts a UUID invoice id', () => {
    expect(isInvoiceUuid('11111111-1111-7111-8111-111111111111')).toBe(true);
    expect(isInvoiceUuid(' not-a-uuid ')).toBe(false);
    expect(isInvoiceUuid('')).toBe(false);
  });

  it('round-trips ISO through datetime-local', () => {
    const iso = '2026-09-15T08:00:00.000Z';
    const local = isoToDatetimeLocal(iso, 'America/Los_Angeles');
    expect(local).toBe('2026-09-15T01:00');
    const back = datetimeLocalToIso(local, 'America/Los_Angeles');
    expect(back).toBeTruthy();
    expect(new Date(back!).getTime()).toBe(new Date(iso).getTime());
  });

  it('returns empty/null for invalid values', () => {
    expect(isoToDatetimeLocal(null, 'UTC')).toBe('');
    expect(isoToDatetimeLocal('nope', 'UTC')).toBe('');
    expect(datetimeLocalToIso('', 'UTC')).toBeNull();
    expect(datetimeLocalToIso('not-a-date', 'UTC')).toBeNull();
  });

  it('rejects nonexistent calendar dates, skipped DST times and invalid zones', () => {
    for (const value of ['2026-02-30T10:00', '2026-03-08T02:30', '2026-09-01T24:00']) {
      expect(datetimeLocalToIso(value, 'America/Los_Angeles')).toBeNull();
    }
    expect(datetimeLocalToIso('2026-09-01T10:00', 'invalid')).toBeNull();
    expect(isoToDatetimeLocal('2026-09-01T10:00:00Z', 'invalid')).toBe('');
    expect(isoToDatetimeLocal('2026-09-01T10:00', 'UTC')).toBe('');
  });
  it('handles midnight and winter offsets independently from the device timezone', () => {
    expect(isoToDatetimeLocal('2026-01-01T08:00:00Z', 'America/Los_Angeles')).toBe(
      '2026-01-01T00:00'
    );
    expect(datetimeLocalToIso('2025-12-31T17:00', 'America/Los_Angeles')).toBe(
      '2026-01-01T01:00:00.000Z'
    );
  });

  it('treats a lookup as bound only when it matches the loaded invoice id', () => {
    const loaded = '11111111-1111-7111-8111-111111111111';
    expect(lookupMatchesLoadedInvoice(loaded, loaded)).toBe(true);
    expect(lookupMatchesLoadedInvoice(`  ${loaded}  `, loaded)).toBe(true);
    expect(lookupMatchesLoadedInvoice('22222222-2222-7222-8222-222222222222', loaded)).toBe(false);
    expect(lookupMatchesLoadedInvoice('', loaded)).toBe(false);
  });
});
