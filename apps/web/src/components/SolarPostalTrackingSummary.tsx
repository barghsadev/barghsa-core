import { useState } from 'react';
import { Button } from '@barghsa/ui';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import {
  postalCalendarDate,
  publicPostalUrl,
  type SolarPostalTracking,
} from '../lib/solar-postal-tracking.js';

export function SolarPostalTrackingSummary({
  tracking,
}: {
  tracking: Pick<
    SolarPostalTracking,
    | 'postalStatus'
    | 'trackingNumber'
    | 'sendDate'
    | 'estimatedArrivalDate'
    | 'trackingUrl'
    | 'note'
    | 'recordedAt'
  >;
}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  const link = publicPostalUrl(tracking.trackingUrl);
  const [copied, setCopied] = useState<'copied' | 'error' | null>(null);
  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(tracking.trackingNumber!);
      setCopied('copied');
    } catch {
      setCopied('error');
    }
  }
  return (
    <div className="space-y-3 rounded-lg bg-muted/40 p-4" aria-label={copy('postalTrackingUpdate')}>
      {tracking.trackingNumber && (
        <div className="flex flex-wrap items-center gap-3">
          <p>
            {copy('postalTracking')}:{' '}
            <bdi dir="ltr" className="break-all">
              {tracking.trackingNumber}
            </bdi>
          </p>
          <Button type="button" variant="outline" onClick={() => void copyNumber()}>
            {copy('postalCopyTracking')}
          </Button>
        </div>
      )}
      {copied && (
        <p role="status">{copy(copied === 'copied' ? 'postalCopied' : 'postalCopyError')}</p>
      )}
      {tracking.sendDate && (
        <p>
          {copy('postalSendDate')}:{' '}
          <time dateTime={tracking.sendDate.slice(0, 10)}>
            {postalCalendarDate(tracking.sendDate, locale)}
          </time>
        </p>
      )}
      {tracking.postalStatus === 'shipped' && (
        <div className="space-y-1">
          <p>
            {tracking.estimatedArrivalDate ? (
              <>
                {copy('postalArrivalEstimate')}:{' '}
                <time dateTime={tracking.estimatedArrivalDate}>
                  {postalCalendarDate(tracking.estimatedArrivalDate, locale)}
                </time>
              </>
            ) : (
              copy('postalNoEstimate')
            )}
          </p>
          <p className="text-sm text-muted-foreground">{copy('postalEstimateHelp')}</p>
        </div>
      )}
      {link && (
        <a
          className="flex w-fit max-w-full flex-col underline underline-offset-4"
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{copy('postalTrackingLink')}</span>
          <bdi dir="ltr" className="break-all text-sm">
            {link.host}
          </bdi>
        </a>
      )}
      {tracking.note && (
        <p className="whitespace-pre-wrap break-words">
          {copy('postalTrackingNote')}: <bdi>{tracking.note}</bdi>
        </p>
      )}
      {tracking.recordedAt && (
        <p className="text-sm text-muted-foreground">
          {copy('postalTrackingRecorded')}:{' '}
          <time dateTime={tracking.recordedAt}>{time.format(tracking.recordedAt)}</time>
        </p>
      )}
    </div>
  );
}
