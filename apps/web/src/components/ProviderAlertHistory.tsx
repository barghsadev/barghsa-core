import { providerText } from '@barghsa/i18n/providers';
import type { ProviderAlertEvent } from '../lib/email-providers-api.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';

export function ProviderAlertHistory({ events }: { events: ProviderAlertEvent[] | undefined }) {
  const locale = useLocale();
  const time = useAccountTime();
  if (!events?.length) return null;
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      <p className="font-medium">{providerText('admin.providers.health.alertHistory', locale)}</p>
      <ol className="mt-1 space-y-1">
        {events.map((event, index) => (
          <li key={`${event.kind}-${event.createdAt}-${index}`}>
            {providerText(`admin.providers.health.alert.${event.kind}`, locale)} ·{' '}
            {time.format(event.createdAt)}
          </li>
        ))}
      </ol>
    </div>
  );
}
