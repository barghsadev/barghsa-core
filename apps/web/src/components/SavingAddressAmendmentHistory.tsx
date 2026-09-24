import { Card, CardContent } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { useLocale } from '../hooks/useLocale.js';

export interface SavingAddressAmendment {
  id: string;
  changedAt: string;
  reason: string;
  previousAddress: string;
  address: string;
  previousPostalCode: string;
  postalCode: string;
}

export function SavingAddressAmendmentHistory({
  amendments,
  formatTimestamp,
}: {
  amendments: SavingAddressAmendment[];
  formatTimestamp: (value: string) => string;
}) {
  const locale = useLocale();
  const copy = (key: string) => tSaving(key, locale);
  if (amendments.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h2 className="text-xl font-semibold">{copy('addressAmendments')}</h2>
        <ol className="space-y-4">
          {amendments.map((amendment) => (
            <li key={amendment.id} className="border-s-2 border-primary/40 ps-4 text-sm">
              <time className="text-muted-foreground" dateTime={amendment.changedAt}>
                {formatTimestamp(amendment.changedAt)}
              </time>
              <dl className="mt-2 space-y-2">
                <div>
                  <dt className="text-muted-foreground">{copy('stepAddress')}</dt>
                  <dd>
                    <span className="sr-only">{copy('beforeChange')}: </span>
                    <span dir="auto">{amendment.previousAddress}</span> ·{' '}
                    <bdi>{amendment.previousPostalCode}</bdi>{' '}
                    <span aria-hidden="true">{locale === 'fa' ? '←' : '→'}</span>{' '}
                    <span className="sr-only">{copy('afterChange')}: </span>
                    <span dir="auto">{amendment.address}</span> · <bdi>{amendment.postalCode}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('staffAmendReason')}</dt>
                  <dd className="whitespace-pre-wrap">{amendment.reason}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
