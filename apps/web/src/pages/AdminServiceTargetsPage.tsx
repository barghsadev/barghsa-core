import { useCallback, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Alert, Button } from '@barghsa/ui';
import { loginFormText } from '@barghsa/i18n/login-forms';
import type { ServiceSettingsKind } from '../lib/service-settings-form.js';
import { tServiceSettings as t } from '@barghsa/i18n/service-settings';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { ServiceSettingsEditor } from './ServiceSettingsEditor.js';
import { ServiceWorkflowSettings } from '../components/ServiceWorkflowSettings.js';
export default function AdminServiceTargetsPage() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedServiceTargets key={JSON.stringify([actor, revision])} />;
}
function OwnedServiceTargets() {
  const locale = useLocale();
  const [active, setActive] = useState<ServiceSettingsKind | 'workflows' | null>(null);
  const [access, setAccess] = useState<'ready' | 'workflow-denied' | 'session-ended'>('ready');
  const permissionDenied = useCallback((status?: 401 | 403) => {
    setAccess((current) =>
      status === 401 || current === 'session-ended' ? 'session-ended' : 'workflow-denied'
    );
  }, []);
  const workflowDenied = useCallback((status?: 401 | 403) => {
    if (status === 401) setAccess('session-ended');
  }, []);
  const workflowsBusy = useCallback(
    (busy: boolean) =>
      setActive((owner) => (busy ? 'workflows' : owner === 'workflows' ? null : owner)),
    []
  );
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
      {access === 'session-ended' ? (
        <Alert variant="destructive">
          <p>{loginFormText('sessionEnded', locale)}</p>
          <Link to="/login" className="underline">
            {loginFormText('restart', locale)}
          </Link>
        </Alert>
      ) : (
        <>
          {access === 'workflow-denied' ? (
            <section className="space-y-4" aria-label={t('workflow.title', locale)}>
              <h2 className="text-xl font-semibold">{t('workflow.title', locale)}</h2>
              <Alert variant="destructive">{t('workflow.forbidden', locale)}</Alert>
              <Button type="button" variant="outline" onClick={() => setAccess('ready')}>
                {t('workflow.refresh', locale)}
              </Button>
            </section>
          ) : (
            <ServiceWorkflowSettings
              disabled={active !== null && active !== 'workflows'}
              onBusyChange={workflowsBusy}
              onDenied={workflowDenied}
            />
          )}
          <ServiceSettingsEditor
            kind="targets"
            disabled={active !== null && active !== 'targets'}
            onBusyChange={targetsBusy}
            onDenied={permissionDenied}
          />
          <ServiceSettingsEditor
            kind="escalation"
            disabled={active !== null && active !== 'escalation'}
            onBusyChange={escalationBusy}
            onDenied={permissionDenied}
          />
        </>
      )}
    </section>
  );
}
