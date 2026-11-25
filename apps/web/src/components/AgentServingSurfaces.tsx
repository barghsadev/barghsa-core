import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, LoadingStatus } from '@barghsa/ui';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { isAgentSlots } from '../lib/assignment-settings.js';

export function AgentServingSurfaces({
  agentId,
  locale,
}: {
  agentId: string;
  locale: 'fa' | 'en';
}) {
  const scope = useCatalogueScope();
  const slots = useCatalogueResource(scope, '/api/admin/agent-slots', isAgentSlots);
  const assignments = slots.data?.filter((slot) => slot.agent?.id === agentId) ?? [];
  const label = (key: string) => t(`admin.agents.${key}`, locale);
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="font-semibold">{label('servingSurfaces')}</h2>
      {slots.loading && <LoadingStatus>{label('loading')}</LoadingStatus>}
      {scope.denied && (
        <p className="text-sm text-muted-foreground">{label('assignmentsUnavailable')}</p>
      )}
      {slots.error && (
        <div className="space-y-2" role="alert">
          <p>{label('assignmentsUnavailable')}</p>
          <Button type="button" variant="outline" onClick={slots.retry}>
            {label('retry')}
          </Button>
        </div>
      )}
      {!slots.loading &&
        !slots.error &&
        slots.data &&
        (assignments.length ? (
          <ul className="list-inside list-disc space-y-1 text-sm">
            {assignments.map((slot) => (
              <li key={slot.slotKey}>
                <Link
                  to="/admin/agent-slots/$slotKey/{-$action}"
                  params={{ slotKey: slot.slotKey, action: undefined }}
                  className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline"
                >
                  {t(`admin.slots.${slot.slotKey}`, locale)}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{label('noAssignments')}</p>
        ))}
      {!scope.denied && slots.data && (
        <Link
          to="/admin/agent-slots"
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('admin.slots.title', locale)}
        </Link>
      )}
    </section>
  );
}
