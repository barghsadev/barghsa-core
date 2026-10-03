import { useCallback, useState } from 'react';
import type { ServiceSettingsKind } from '../lib/service-settings-form.js';
import { tServiceSettings as t } from '@barghsa/i18n/service-settings';
import { useLocale } from '../hooks/useLocale.js';
import { ServiceSettingsEditor } from './ServiceSettingsEditor.js';
export default function AdminServiceTargetsPage() {
  const locale = useLocale();
  const [active, setActive] = useState<ServiceSettingsKind | null>(null);
  const targetsBusy = useCallback(
    (busy: boolean) =>
      setActive((owner) => (busy ? 'targets' : owner === 'targets' ? null : owner)),
    []
  );
  const escalationBusy = useCallback(
    (busy: boolean) =>
      setActive((owner) => (busy ? 'escalation' : owner === 'escalation' ? null : owner)),
    []
  );

  return (
    <section className="space-y-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-semibold">{t('admin.targets.pageTitle', locale)}</h1>
      <ServiceSettingsEditor
        kind="targets"
        disabled={active !== null && active !== 'targets'}
        onBusyChange={targetsBusy}
      />
      <ServiceSettingsEditor
        kind="escalation"
        disabled={active !== null && active !== 'escalation'}
        onBusyChange={escalationBusy}
      />
    </section>
  );
}
