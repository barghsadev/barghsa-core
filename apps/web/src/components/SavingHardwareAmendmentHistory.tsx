import { Card, CardContent } from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { tSaving } from '@barghsa/i18n/saving';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export interface SavingHardwareAmendment {
  id: string;
  changedAt: string;
  reason: string;
  priceDeltaIrR: string;
  adjustmentInvoiceId: string | null;
  previousTitle: { fa: string; en: string };
  hardwareTitle: { fa: string; en: string };
}

export function SavingHardwareAmendmentHistory({
  amendments,
}: {
  amendments: SavingHardwareAmendment[];
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  if (amendments.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h2 className="text-xl font-semibold">{copy('hardwareAmendments')}</h2>
        <ol className="space-y-4">
          {amendments.map((amendment) => (
            <li key={amendment.id} className="border-s-2 border-primary/40 ps-4 text-sm">
              <time className="text-muted-foreground" dateTime={amendment.changedAt}>
                {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(amendment.changedAt))}
              </time>
              <p className="mt-2">
                <span className="sr-only">{copy('beforeChange')}: </span>
                {amendment.previousTitle[locale]}{' '}
                <span aria-hidden="true">{locale === 'fa' ? '←' : '→'}</span>{' '}
                <span className="sr-only">{copy('afterChange')}: </span>
                {amendment.hardwareTitle[locale]}
              </p>
              {amendment.adjustmentInvoiceId ? (
                <p className="text-muted-foreground">
                  {copy(
                    BigInt(amendment.priceDeltaIrR) > 0n
                      ? 'hardwareAdditionalCharge'
                      : 'hardwareCreditIssued'
                  )}
                  :{' '}
                  <bdi>
                    {numbers.money(
                      (BigInt(amendment.priceDeltaIrR) < 0n
                        ? -BigInt(amendment.priceDeltaIrR)
                        : BigInt(amendment.priceDeltaIrR)
                      ).toString()
                    )}
                  </bdi>{' '}
                  <Link
                    to="/invoices/$invoiceId"
                    params={{ invoiceId: amendment.adjustmentInvoiceId }}
                    className="text-primary underline"
                  >
                    {copy('invoice')}
                  </Link>
                </p>
              ) : (
                <p className="text-muted-foreground">{copy('hardwareNoPriceChange')}</p>
              )}
              <p className="mt-2 whitespace-pre-wrap">
                <span className="text-muted-foreground">{copy('staffAmendReason')}: </span>
                {amendment.reason}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
