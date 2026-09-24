import { Card, CardContent } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export interface SavingOrderRevision {
  id: string;
  changedAt: string;
  previousHardwareTitle: { fa: string; en: string } | null;
  hardwareTitle: { fa: string; en: string } | null;
  previousAddress: string | null;
  address: string | null;
  previousTotalIrR: string | null;
  totalIrR: string | null;
}

export function SavingOrderRevisionHistory({
  revisions,
  formatTimestamp,
}: {
  revisions: SavingOrderRevision[];
  formatTimestamp: (value: string) => string;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  if (revisions.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h2 className="text-xl font-semibold">{copy('changeHistory')}</h2>
        <ol className="space-y-4">
          {revisions.map((revision) => (
            <li key={revision.id} className="border-s-2 border-primary/40 ps-4">
              <time className="text-sm text-muted-foreground" dateTime={revision.changedAt}>
                {formatTimestamp(revision.changedAt)}
              </time>
              <dl className="mt-2 space-y-2 text-sm">
                {revision.previousHardwareTitle &&
                  revision.hardwareTitle &&
                  revision.previousHardwareTitle[locale] !== revision.hardwareTitle[locale] && (
                    <div>
                      <dt className="text-muted-foreground">{copy('stepHardware')}</dt>
                      <dd>
                        <span className="sr-only">{copy('beforeChange')}: </span>
                        <span dir="auto">{revision.previousHardwareTitle[locale]}</span>{' '}
                        <span aria-hidden="true">{locale === 'fa' ? '←' : '→'}</span>{' '}
                        <span className="sr-only">{copy('afterChange')}: </span>
                        <span dir="auto">{revision.hardwareTitle[locale]}</span>
                      </dd>
                    </div>
                  )}
                {revision.previousAddress !== revision.address && (
                  <div>
                    <dt className="text-muted-foreground">{copy('stepAddress')}</dt>
                    <dd>
                      <span className="sr-only">{copy('beforeChange')}: </span>
                      <span dir="auto">{revision.previousAddress}</span>{' '}
                      <span aria-hidden="true">{locale === 'fa' ? '←' : '→'}</span>{' '}
                      <span className="sr-only">{copy('afterChange')}: </span>
                      <span dir="auto">{revision.address}</span>
                    </dd>
                  </div>
                )}
                {revision.previousTotalIrR && revision.totalIrR && (
                  <div>
                    <dt className="text-muted-foreground">{copy('total')}</dt>
                    <dd>
                      <span className="sr-only">{copy('beforeChange')}: </span>
                      <bdi>{numbers.money(revision.previousTotalIrR)}</bdi>{' '}
                      <span aria-hidden="true">{locale === 'fa' ? '←' : '→'}</span>{' '}
                      <span className="sr-only">{copy('afterChange')}: </span>
                      <bdi>{numbers.money(revision.totalIrR)}</bdi>
                    </dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
