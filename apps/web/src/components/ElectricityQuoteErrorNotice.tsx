import { t } from '@barghsa/i18n/workspace';
import { Button } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';

export function ElectricityQuoteErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const locale = useLocale();
  return (
    <div role="alert" className="space-y-1 text-sm text-destructive">
      <p>{message}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={onRetry}>
          {t('electricity.order.retry', locale)}
        </Button>
        <a
          href="/support"
          className="inline-block underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t('electricity.order.contactSupport', locale)}
        </a>
      </div>
    </div>
  );
}
