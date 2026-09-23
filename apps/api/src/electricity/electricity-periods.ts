/** Half-open electricity delivery period in the official Iran time zone. */
export interface ElectricityPeriod {
  start: Date;
  end: Date;
}

type CivilDate = { year: number; month: number; day: number };

const gregorian = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});
const persian = new Intl.DateTimeFormat('en-US-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function parts(formatter: Intl.DateTimeFormat, date: Date): CivilDate {
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function key(date: CivilDate): number {
  return date.year * 10_000 + date.month * 100 + date.day;
}

function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** First UTC millisecond of a civil day in Asia/Tehran, including historical offsets. */
function startOfTehranDay(day: CivilDate): Date {
  const noonUtc = Date.UTC(day.year, day.month - 1, day.day, 12);
  let low = noonUtc - 36 * 60 * 60 * 1000;
  let high = noonUtc + 12 * 60 * 60 * 1000;
  const wanted = key(day);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (key(parts(gregorian, new Date(middle))) >= wanted) high = middle;
    else low = middle + 1;
  }
  if (key(parts(gregorian, new Date(low))) !== wanted) {
    throw new RangeError('Iran civil day is unavailable');
  }
  return new Date(low);
}

function assertNow(now: Date): void {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new RangeError('A valid current instant is required');
  }
}

function followingJalaliMonthStart(now: Date): Date {
  const today = parts(gregorian, now);
  const current = parts(persian, now);
  for (let offset = 1; offset <= 32; offset++) {
    const candidate = addDays(today, offset);
    const midday = new Date(Date.UTC(candidate.year, candidate.month - 1, candidate.day, 12));
    const month = parts(persian, midday);
    if (month.year !== current.year || month.month !== current.month) {
      return startOfTehranDay(candidate);
    }
  }
  throw new RangeError('Could not find the next Jalali month');
}

function nextSaturday(now: Date): Date {
  const today = parts(gregorian, now);
  const dayOfWeek = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  const daysAhead = (6 - dayOfWeek + 7) % 7 || 7;
  return startOfTehranDay(addDays(today, daysAhead));
}

/** Remaining current Jalali month: [now, first instant of next month). */
export function getCurrentJalaliMonthRange(now: Date): ElectricityPeriod {
  assertNow(now);
  return { start: new Date(now), end: followingJalaliMonthStart(now) };
}

/** Entire following Jalali month, including its 29th, 30th or 31st day. */
export function getNextJalaliMonthRange(now: Date): ElectricityPeriod {
  assertNow(now);
  const start = followingJalaliMonthStart(now);
  return { start, end: followingJalaliMonthStart(start) };
}

/** Remaining current Saturday–Friday week, beginning at the current instant. */
export function getCurrentWeekRange(now: Date): ElectricityPeriod {
  assertNow(now);
  return { start: new Date(now), end: nextSaturday(now) };
}

/** Entire next Saturday–Friday week in Iran. */
export function getNextWeekRange(now: Date): ElectricityPeriod {
  assertNow(now);
  const start = nextSaturday(now);
  const civil = parts(gregorian, start);
  return { start, end: startOfTehranDay(addDays(civil, 7)) };
}

/** Entire Saturday–Friday week after next. */
export function getWeekAfterNextRange(now: Date): ElectricityPeriod {
  assertNow(now);
  const next = getNextWeekRange(now);
  const civil = parts(gregorian, next.end);
  return { start: next.end, end: startOfTehranDay(addDays(civil, 7)) };
}
