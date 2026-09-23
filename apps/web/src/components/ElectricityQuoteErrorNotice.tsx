import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';

export function ElectricityQuoteErrorNotice({ message }: { message: string }) {
  const locale = useLocale();
  return (
    <div role="alert" className="space-y-1 text-sm text-destructive">
      <p>{message}</p>
      <a
        href="/support"
        className="inline-block underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {t('electricity.order.contactSupport', locale)}
      </a>
    </div>
  );
}
