import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Alert, Button } from '@barghsa/ui';
import { loginFormText } from '@barghsa/i18n/login-forms';
import type { ServiceWorkflowKey } from '@barghsa/shared/admin';
import type { ServiceSettingsKind } from '../lib/service-settings-form.js';
import { tServiceSettings as t } from '@barghsa/i18n/service-settings';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { ServiceSettingsEditor } from './ServiceSettingsEditor.js';
import { ServiceWorkflowSettings } from '../components/ServiceWorkflowSettings.js';
const sections = [
  { key: 'workflows', title: 'workflow.title', description: 'workflow.note' },
  { key: 'response-times', title: 'admin.targets.title', description: 'admin.targets.note' },
  { key: 'escalation', title: 'admin.escalation.title', description: 'admin.escalation.note' },
] as const;
type View = 'overview' | (typeof sections)[number]['key'];
export default function AdminServiceTargetsPage({
  view,
  workflow,
}: { view?: View; workflow?: ServiceWorkflowKey } = {}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedServiceTargets
      key={JSON.stringify([actor, revision, workflow])}
      view={view}
      workflow={workflow}
    />
  );
}
function OwnedServiceTargets({
  view,
  workflow,
}: {
  view: View | undefined;
  workflow: ServiceWorkflowKey | undefined;
}) {
  const locale = useLocale();
  const heading = useRef<HTMLHeadingElement>(null);
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
  useEffect(() => {
    if (view && view !== 'overview') heading.current?.focus({ preventScroll: true });
  }, [view, workflow]);

  const headingContent = (
    <div className="min-w-0 flex-1 space-y-1">
      {workflow ? (
        <Link
          to="/admin/service-targets/$section/{-$workflow}"
          params={{ section: 'workflows', workflow: undefined }}
          className="touch-action text-sm text-primary underline underline-offset-4"
        >
          {t('workflow.backToWorkflows', locale)}
        </Link>
      ) : (
        view &&
        view !== 'overview' && (
          <Link
            to="/admin/service-targets"
            className="inline-flex text-sm text-primary hover:underline"
          >
            {t('admin.targets.pageTitle', locale)}
          </Link>
        )
      )}
      <h1
        ref={heading}
        tabIndex={view && view !== 'overview' ? -1 : undefined}
        className="text-2xl font-semibold focus-visible:shadow-none! focus-visible:outline-hidden!"
      >
        {t(
          workflow
            ? `workflow.${workflow}`
            : view === 'workflows'
              ? 'workflow.pageTitle'
              : view && view !== 'overview'
                ? 'admin.targets.editSettings'
                : 'admin.targets.pageTitle',
          locale
        )}
      </h1>
    </div>
  );
  return (
    <section
      className={view && view !== 'overview' ? 'mx-auto w-full max-w-3xl space-y-4' : 'space-y-6'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {(view !== 'workflows' || access !== 'ready') && <header>{headingContent}</header>}
      {view === 'overview' && (
        <ul className="grid gap-4 lg:grid-cols-3">
          {sections.map((section) => (
            <li key={section.key} className="min-w-0">
              <Link
                to="/admin/service-targets/$section/{-$workflow}"
                params={{ section: section.key }}
                className="block h-full space-y-2 rounded-xl border bg-card p-4 hover:border-primary sm:p-5"
                aria-label={`${t('admin.targets.openSettings', locale)} · ${t(section.title, locale)}`}
              >
                <h2 className="text-lg font-semibold text-primary underline underline-offset-4">
                  {t(section.title, locale)}
                </h2>
                <p className="text-sm text-muted-foreground">{t(section.description, locale)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {access === 'session-ended' ? (
        <Alert variant="destructive">
          <p>{loginFormText('sessionEnded', locale)}</p>
          <Link to="/login" className="underline">
            {loginFormText('restart', locale)}
          </Link>
        </Alert>
      ) : (
        <>
          {(!view || view === 'workflows') &&
            (access === 'workflow-denied' ? (
              <section className="space-y-4" aria-label={t('workflow.title', locale)}>
                <h2 className="text-xl font-semibold">{t('workflow.title', locale)}</h2>
                <Alert variant="destructive">{t('workflow.forbidden', locale)}</Alert>
                <Button type="button" variant="outline" onClick={() => setAccess('ready')}>
                  {t('workflow.refresh', locale)}
                </Button>
              </section>
            ) : (
              <ServiceWorkflowSettings
                showComparison={!!view}
                {...(view === 'workflows' && { heading: headingContent })}
                {...(workflow && { workflow })}
                disabled={active !== null && active !== 'workflows'}
                onBusyChange={workflowsBusy}
                onDenied={workflowDenied}
              />
            ))}
          {(!view || view === 'response-times') && (
            <ServiceSettingsEditor
              kind="targets"
              disabled={active !== null && active !== 'targets'}
              onBusyChange={targetsBusy}
              onDenied={permissionDenied}
              showComparison={!!view}
            />
          )}
          {(!view || view === 'escalation') && (
            <ServiceSettingsEditor
              kind="escalation"
              disabled={active !== null && active !== 'escalation'}
              onBusyChange={escalationBusy}
              onDenied={permissionDenied}
              showComparison={!!view}
            />
          )}
        </>
      )}
    </section>
  );
}
