import type { Locale } from '@barghsa/i18n/app';

type ReceiptCalendar = 'gregory' | 'persian';
const formats: Partial<Record<`${Locale}-${ReceiptCalendar}`, Intl.DateTimeFormat>> = {};

/** A bank deposit date is a calendar day independent of the account timezone. */
export function ReceiptDepositDate({
  value,
  locale,
  calendar = locale === 'fa' ? 'persian' : 'gregory',
}: {
  value: string | null | undefined;
  calendar?: ReceiptCalendar;
  locale: Locale;
}) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return <>—</>;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return <>—</>;
  const key = `${locale}-${calendar}` as const;
  const formatter = (formats[key] ??= new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    calendar,
    dateStyle: 'medium',
    timeZone: 'UTC',
  }));
  return <time dateTime={value}>{formatter.format(date)}</time>;
}
