import { datePickerAtTime, datePickerCalendarDate } from '@barghsa/ui';

/**
 * UI helpers for the staff dueAt override form (T-04.1.03.03).
 *
 * datetime-local values use the saved account timezone; the API expects ISO-8601.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isInvoiceUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * True when the lookup field still identifies the invoice currently loaded
 * into the override form. A mismatch must discard the loaded invoice so a
 * staff member cannot override invoice A while the field shows invoice B.
 */
export function lookupMatchesLoadedInvoice(lookupId: string, loadedInvoiceId: string): boolean {
  return lookupId.trim() === loadedInvoiceId;
}

/** Convert an instant to a Gregorian wall-clock value in the explicit account zone. */
export function isoToDatetimeLocal(iso: string | null | undefined, timezone: string): string {
  if (!iso || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(iso));
    const part = (type: string) => parts.find((value) => value.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
  } catch {
    return '';
  }
}

/** Resolve account wall-clock input, rejecting invalid dates and DST gaps. */
export function datetimeLocalToIso(value: string, timezone: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    const day = datePickerCalendarDate(match[1]!, timezone);
    return day
      ? (datePickerAtTime(day, Number(match[2]), Number(match[3]), timezone)?.toISOString() ?? null)
      : null;
  } catch {
    return null;
  }
}
