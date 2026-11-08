import { Button } from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/workspace';
import { useEffect, useRef } from 'react';
import { useLocale } from '../hooks/useLocale.js';

export function SubmissionRecovery({
  busy,
  onRetry,
  history = '/electricity/orders',
  copy,
}: {
  busy: boolean;
  onRetry: () => void;
  history?: '/electricity/orders' | '/savings/orders' | '/solar/requests';
  copy?: { unconfirmed: string; retry: string; busy: string; history: string };
}) {
  const locale = useLocale();
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!busy) retry.current?.focus();
  }, [busy]);
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p role="alert">{copy?.unconfirmed ?? t('electricity.order.unconfirmed', locale)}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button ref={retry} type="button" disabled={busy} onClick={onRetry}>
          {(busy ? copy?.busy : copy?.retry) ??
            t(busy ? 'electricity.order.submitting' : 'electricity.order.retrySubmission', locale)}
        </Button>
        <Link to={history} className="touch-action text-sm text-primary underline">
          {copy?.history ?? t('electricity.order.checkOrders', locale)}
        </Link>
      </div>
    </div>
  );
}
