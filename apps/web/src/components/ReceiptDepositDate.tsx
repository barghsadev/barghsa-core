import { useMemo } from 'react';
import { useLocale } from '../hooks/useLocale.js';

/** A bank deposit date is a Gregorian calendar day, not an account-timezone instant. */
export function ReceiptDepositDate({ value }: { value: string | null | undefined }) {
  const locale = useLocale();
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-US', {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }),
    [locale]
  );
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return <>—</>;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return <>—</>;
  return <time dateTime={value}>{formatter.format(date)}</time>;
}
