import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Label, ListPage } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import {
  isAgentSlots,
  isAssignmentAgents,
  isAgentSlot,
  slotBasis,
  type SlotKey,
} from '../lib/assignment-settings.js';

type AssignmentReview = TeamAction & {
  slotKey: SlotKey;
  agentId: string | null;
  basis: string;
  epoch: number;
};
export default function AdminAgentSlotsPage() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.slots.${key}`, locale);
  const [choices, setChoices] = useState<Partial<Record<SlotKey, { id: string; basis: string }>>>(
    {}
  );
  const [action, setAction] = useState<AssignmentReview | null>(null),
    [saved, setSaved] = useState(false);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const clearPrivate = useCallback(() => {
    setChoices({});
    setAction(null);
    setSaved(false);
  }, []);
  const scope = useCatalogueScope(clearPrivate);
  const slots = useCatalogueResource(scope, '/api/admin/agent-slots', isAgentSlots);
  const agents = useCatalogueResource(scope, '/api/admin/agents', isAssignmentAgents);
  const ready =
    !scope.denied &&
    slots.data !== null &&
    agents.data !== null &&
    !slots.loading &&
    !agents.loading &&
    !slots.error &&
    !agents.error;
  const reviewBasis = (slotKey: SlotKey, agentId: string | null) => {
    const slot = slots.data?.find((row) => row.slotKey === slotKey);
    const agent = agents.data?.find((row) => row.id === agentId);
    return JSON.stringify([
      slot ? slotBasis(slot) : null,
      agentId === null
        ? null
        : agent
          ? [agent.id, agent.title, agent.enabled, agent.updatedAt]
          : 'unavailable',
      slots.data
        ?.filter((row) => row.slotKey !== slotKey && agentId && row.agent?.id === agentId)
        .map((row) => slotBasis(row))
        .sort(),
    ]);
  };
  const currentBasis = action ? reviewBasis(action.slotKey, action.agentId) : null;
  const reviewed = useRef({ action, basis: currentBasis });
  reviewed.current = { action, basis: currentBasis };
  useEffect(() => {
    if (action && (action.epoch !== scope.version || action.basis !== currentBasis))
      setAction(null);
  }, [action, currentBasis, scope.version]);
  const refreshSlots = () => (scope.denied ? scope.recover() : slots.retry());
  const recovery = (dialog = false) => (
    <div className="flex flex-wrap items-start gap-3">
      <div className="space-y-2">
        {slots.error && dialog && <p role="alert">{label('error')}</p>}
        <Button
          ref={dialog ? undefined : refreshButton}
          type="button"
          variant="outline"
          disabled={slots.loading}
          onClick={refreshSlots}
        >
          {label('refresh')}
        </Button>
      </div>
      {!scope.denied && (
        <div className="space-y-2">
          {agents.loading && <p role="status">{label('agentsLoading')}</p>}
          {agents.error && <p role="alert">{label('agentsError')}</p>}
          <Button type="button" variant="outline" disabled={agents.loading} onClick={agents.retry}>
            {label('agentsRetry')}
          </Button>
        </div>
      )}
    </div>
  );
  return (
    <section
      className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header>
        <h1 className="text-2xl font-semibold">{label('title')}</h1>
        <p className="mt-2">{label('description')}</p>
      </header>
      {saved && <p role="status">{label('saved')}</p>}
      <ListPage>
        <ListPage.Toolbar>{recovery()}</ListPage.Toolbar>
        <ListPage.Content
          loading={slots.loading}
          error={slots.error || scope.denied}
          empty={false}
          emptyView={null}
          retainContent={slots.data !== null}
          loadingView={<p role="status">{label('loading')}</p>}
          errorView={<p role="alert">{label(scope.denied ? 'denied' : 'error')}</p>}
        >
          <div className="divide-y">
            {slots.data?.map((slot) => {
              const draft = choices[slot.slotKey],
                choice = draft?.id ?? slot.agent?.id ?? '';
              const selected = agents.data?.find((agent) => agent.id === choice);
              const missing = !!choice && !selected;
              const unavailable = missing && agents.data !== null;
              const stale = !!draft && draft.basis !== slotBasis(slot);
              const shared = slots
                .data!.filter(
                  (other) => other.slotKey !== slot.slotKey && choice && other.agent?.id === choice
                )
                .map((other) => label(other.slotKey));
              return (
                <form
                  key={slot.slotKey}
                  className="min-w-0 space-y-3 py-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (
                      !ready ||
                      action ||
                      stale ||
                      unavailable ||
                      choice === (slot.agent?.id ?? '')
                    )
                      return;
                    setSaved(false);
                    const agentId = choice || null;
                    setAction({
                      slotKey: slot.slotKey,
                      agentId,
                      basis: reviewBasis(slot.slotKey, agentId),
                      epoch: scope.version,
                      title: label('save'),
                      description: `${label(slot.slotKey)}: ${slot.agent?.title ?? label('unassigned')} → ${selected?.title ?? label('unassigned')}. ${selected && !selected.enabled ? label('disabledHelp') : ''} ${shared.length ? `${label('shared')}: ${shared.join(locale === 'fa' ? '، ' : ', ')}. ` : ''}${label('confirm')}`,
                      path: `/api/admin/agent-slots/${slot.slotKey}/agent`,
                      method: 'PUT',
                      body: { agentId },
                      forbiddenMessage: label('denied'),
                      conflictMessage: label('conflict'),
                    });
                  }}
                >
                  <h2 className="text-lg font-semibold">{label(slot.slotKey)}</h2>
                  <p className="text-sm text-muted-foreground">
                    {label('current')}: {slot.agent?.title ?? label('unassigned')}
                  </p>
                  {stale && <p role="alert">{label('stale')}</p>}
                  {unavailable && <p role="alert">{label('unavailable')}</p>}
                  <fieldset disabled={!!action} className="flex min-w-0 flex-wrap items-end gap-3">
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor={`slot-${slot.slotKey}`}>
                        {label('agent')} · {label(slot.slotKey)}
                      </Label>
                      <select
                        id={`slot-${slot.slotKey}`}
                        className="max-w-full rounded-md border bg-background p-2"
                        value={choice}
                        onChange={(event) => {
                          setSaved(false);
                          setChoices((current) => ({
                            ...current,
                            [slot.slotKey]: {
                              id: event.target.value,
                              basis: draft?.basis ?? slotBasis(slot),
                            },
                          }));
                        }}
                      >
                        <option value="">{label('unassigned')}</option>
                        {missing && (
                          <option value={choice}>
                            {slot.agent?.id === choice
                              ? slot.agent.title
                              : label('unavailableChoice')}
                          </option>
                        )}
                        {agents.data?.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.title}
                            {agent.enabled ? '' : ` (${label('disabled')})`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="submit"
                      disabled={!ready || stale || unavailable || choice === (slot.agent?.id ?? '')}
                      aria-label={`${label('save')} ${label(slot.slotKey)}`}
                    >
                      {label('save')}
                    </Button>
                    {draft && (
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={`${label('reset')} ${label(slot.slotKey)}`}
                        onClick={() => {
                          setChoices((current) => {
                            const next = { ...current };
                            delete next[slot.slotKey];
                            return next;
                          });
                          setSaved(false);
                        }}
                      >
                        {label('reset')}
                      </Button>
                    )}
                  </fieldset>
                  {selected && !selected.enabled && (
                    <p className="text-sm" role="status">
                      {label('disabledHelp')}
                    </p>
                  )}
                  {shared.length > 0 && (
                    <p className="text-sm">
                      {label('shared')}: {shared.join(locale === 'fa' ? '، ' : ', ')}
                    </p>
                  )}
                </form>
              );
            })}
          </div>
        </ListPage.Content>
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          onDenied={scope.deny}
          summary={recovery(true)}
          confirmationDisabled={
            !ready || action.epoch !== scope.version || action.basis !== currentBasis
          }
          finalFocus={() => refreshButton.current}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            if (
              scope.live.current !== action.epoch ||
              reviewed.current.action !== action ||
              reviewed.current.basis !== action.basis
            )
              return;
            const chosen = agents.data!.find((agent) => agent.id === action.agentId);
            const sharing = slots
              .data!.filter(
                (row) =>
                  row.slotKey !== action.slotKey &&
                  action.agentId !== null &&
                  row.agent?.id === action.agentId
              )
              .map((row) => row.slotKey)
              .sort();
            if (
              !isAgentSlot(result) ||
              result.slotKey !== action.slotKey ||
              (result.agent?.id ?? null) !== action.agentId ||
              (result.agent !== null &&
                (result.agent.title !== chosen?.title ||
                  result.agent.enabled !== chosen?.enabled)) ||
              JSON.stringify([...result.alsoUsedIn].sort()) !== JSON.stringify(sharing)
            )
              throw new Error('Invalid assignment acknowledgement');
            const nextSlots = slots.data!.map((row) =>
              row.slotKey === result.slotKey ? result : row
            );
            const accepted = nextSlots.map((row) => ({
              ...row,
              alsoUsedIn:
                row.agent === null
                  ? []
                  : nextSlots
                      .filter(
                        (other) =>
                          other.slotKey !== row.slotKey && other.agent?.id === row.agent!.id
                      )
                      .map((other) => other.slotKey),
            }));
            if (!slots.accept(accepted)) return;
            setChoices((current) => {
              const next = { ...current };
              delete next[action.slotKey];
              return next;
            });
            setSaved(true);
            slots.retry();
          }}
        />
      )}
    </section>
  );
}
