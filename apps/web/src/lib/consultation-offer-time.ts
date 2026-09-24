import { datePickerAtTime, datePickerCalendarDate } from '@barghsa/ui';

/** HTML datetime-local fields carry a wall time, not an instant. */
export function offerInputFromInstant(value: string | null, timezone: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function offerInstantFromInput(value: string, timezone: string): Date | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const day = datePickerCalendarDate(match[1]!, timezone);
  return day && datePickerAtTime(day, Number(match[2]), Number(match[3]), timezone);
}
