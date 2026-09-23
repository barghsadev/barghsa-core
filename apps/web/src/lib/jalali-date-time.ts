const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function parts(date: Date): Parts {
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  return values as Parts;
}

function key(value: Parts): number {
  return (
    (((value.year * 100 + value.month) * 100 + value.day) * 100 + value.hour) * 100 + value.minute
  );
}

export function formatJalaliDateTime(date: Date): string {
  const value = parts(date);
  return `${value.year.toString().padStart(4, '0')}-${value.month.toString().padStart(2, '0')}-${value.day.toString().padStart(2, '0')}T${value.hour.toString().padStart(2, '0')}:${value.minute.toString().padStart(2, '0')}`;
}

/** Converts a Jalali date and Iran civil time to an ISO instant; rejects nonexistent days. */
export function parseJalaliDateTime(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (
    !year ||
    !month ||
    !day ||
    hour === undefined ||
    minute === undefined ||
    month > 12 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  )
    return null;
  const target = key({ year, month, day, hour, minute });
  let low = Math.floor(Date.UTC(year + 621, 2, 1) / 60_000);
  let high = Math.ceil(Date.UTC(year + 622, 3, 1) / 60_000);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (key(parts(new Date(mid * 60_000))) >= target) high = mid;
    else low = mid + 1;
  }
  const date = new Date(low * 60_000);
  return key(parts(date)) === target ? date.toISOString() : null;
}
