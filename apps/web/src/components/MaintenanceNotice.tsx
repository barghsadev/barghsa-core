import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { tMaintenance } from '@barghsa/i18n/maintenance';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import {
  useMaintenance,
  type MaintenanceCapability,
  type PublicMaintenanceSetting,
} from '../hooks/useMaintenance.js';

export function MaintenanceNotice({ setting }: { setting: PublicMaintenanceSetting }) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tMaintenance(key, locale);
  return (
    <section
      role="status"
      className="rounded-lg border border-warning/30 bg-warning-soft p-5 text-foreground"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-xl font-semibold">{copy('title')}</h1>
      <p className="mt-2">{copy('description')}</p>
      {setting.reason && <p className="mt-2">{setting.reason[locale]}</p>}
      {setting.estimatedUntil && (
        <p className="mt-2 text-sm">
          {copy('until')}:{' '}
          <time dateTime={setting.estimatedUntil}>{time.format(setting.estimatedUntil)}</time>
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-4 text-sm font-medium text-primary">
        <Link to="/tickets" className="underline underline-offset-4">
          {copy('support')}
        </Link>
        <Link to="/dashboard" className="underline underline-offset-4">
          {copy('back')}
        </Link>
      </div>
    </section>
  );
}

export function MaintenanceBoundary({
  capability,
  children,
}: {
  capability: MaintenanceCapability;
  children: ReactNode;
}) {
  const setting = useMaintenance(capability);
  return setting?.active ? (
    <main className="mx-auto max-w-3xl p-4 md:p-8">
      <MaintenanceNotice setting={setting} />
    </main>
  ) : (
    children
  );
}
