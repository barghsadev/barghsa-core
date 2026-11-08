import { Button } from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/workspace';
import { useEffect, useRef } from 'react';
import { useLocale } from '../hooks/useLocale.js';

export function ElectricityOrderRecovery({
  busy,
  onRetry,
}: {
  busy: boolean;
  onRetry: () => void;
}) {
  const locale = useLocale();
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!busy) retry.current?.focus();
  }, [busy]);
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p role="alert">{t('electricity.order.unconfirmed', locale)}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button ref={retry} type="button" disabled={busy} onClick={onRetry}>
          {t(busy ? 'electricity.order.submitting' : 'electricity.order.retrySubmission', locale)}
        </Button>
        <Link to="/electricity/orders" className="touch-action text-sm text-primary underline">
          {t('electricity.order.checkOrders', locale)}
        </Link>
      </div>
    </div>
  );
}
