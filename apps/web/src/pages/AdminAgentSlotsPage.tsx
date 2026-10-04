import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, ListPage } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { aiAgentFormText } from '@barghsa/i18n/ai-agent-forms';
import { AgentSlotChoiceForm } from '../components/AgentSlotChoiceForm.js';
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
  const [validating, setValidating] = useState(false),
    [uncertainSlot, setUncertainSlot] = useState<SlotKey | null>(null);
  const generation = useRef(0),
    locked = useRef(false),
    cancelValidation = useRef<(() => void) | null>(null),
    actionRef = useRef<AssignmentReview | null>(null),
    validationErrors = useRef<((fields: unknown[]) => boolean) | null>(null);
  const requiredReads = useRef({ slots: 0, agents: 0 });
  const copy = (key: Parameters<typeof aiAgentFormText>[0]) => aiAgentFormText(key, locale);
  const withdraw = useCallback(() => {
    generation.current++;
    locked.current = false;
    cancelValidation.current?.();
    cancelValidation.current = null;
    setValidating(false);
    setAction(null);
    actionRef.current = null;
    validationErrors.current = null;
  }, []);

  const clearPrivate = useCallback(() => {
    withdraw();
    setChoices({});
    setUncertainSlot(null);
    setSaved(false);
  }, [withdraw]);
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
  const recovered =
    ready &&
    (slots.readAttempt ?? -1) >= requiredReads.current.slots &&
    (agents.readAttempt ?? -1) >= requiredReads.current.agents;
  function refreshSlots() {
    if (locked.current && !actionRef.current) withdraw();
    return scope.denied ? scope.recover() : slots.retry();
  }
  function refreshAgents() {
    if (locked.current && !actionRef.current) withdraw();
    agents.retry();
  }
  function unconfirmed() {
    const command = actionRef.current;
    if (!command) return;
    setUncertainSlot(command.slotKey);
    withdraw();
    requiredReads.current = { slots: slots.retry(), agents: agents.retry() };
  }
  function begin(cancel: () => void) {
    if (locked.current || actionRef.current || uncertainSlot || !ready) return null;
    locked.current = true;
    cancelValidation.current = cancel;
    setValidating(true);
    return generation.current;
  }
  const current = (epoch: number) => epoch === generation.current;
  function finish(epoch: number) {
    if (!current(epoch)) return;
    cancelValidation.current = null;
    locked.current = false;
    setValidating(false);
  }
  function resetChoice(key: SlotKey) {
    if (!ready || validating || actionRef.current || (uncertainSlot === key && !recovered)) return;
    generation.current++;
    setChoices((value) => {
      const next = { ...value };
      delete next[key];
      return next;
    });
    if (uncertainSlot === key) setUncertainSlot(null);
    setSaved(false);
  }

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
    if (action && (action.epoch !== scope.version || action.basis !== currentBasis)) withdraw();
  }, [action, currentBasis, scope.version, withdraw]);
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
          <Button type="button" variant="outline" disabled={agents.loading} onClick={refreshAgents}>
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
      {uncertainSlot && (
        <>
          <Alert variant="destructive">{copy('uncertain')}</Alert>
          <Button
            type="button"
            variant="outline"
            disabled={!recovered || !!action || validating}
            onClick={() => resetChoice(uncertainSlot)}
          >
            {copy('reset')}
          </Button>
        </>
      )}
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
              const stale = !!draft && draft.basis !== slotBasis(slot);
              const shared = slots
                .data!.filter(
                  (other) => other.slotKey !== slot.slotKey && choice && other.agent?.id === choice
                )
                .map((other) => label(other.slotKey));
              return (
                <AgentSlotChoiceForm
                  key={slot.slotKey}
                  slot={slot}
                  agents={agents.data ?? []}
                  draft={draft}
                  stale={stale}
                  ready={ready}
                  locked={!!action || validating}
                  blocked={!!uncertainSlot}
                  resetBlocked={!!action || validating || (!!uncertainSlot && !recovered)}
                  locale={locale}
                  label={label}
                  shared={shared}
                  onChange={(id) => {
                    setSaved(false);
                    setChoices((value) => ({
                      ...value,
                      [slot.slotKey]: { id, basis: draft?.basis ?? slotBasis(slot) },
                    }));
                  }}
                  onReset={() => resetChoice(slot.slotKey)}
                  begin={begin}
                  current={current}
                  finish={finish}
                  propose={(epoch, agentId, errors) => {
                    if (!current(epoch) || !ready || stale || actionRef.current || uncertainSlot)
                      return;
                    setSaved(false);
                    validationErrors.current = errors;
                    const next: AssignmentReview = {
                      slotKey: slot.slotKey,
                      agentId,
                      basis: reviewBasis(slot.slotKey, agentId),
                      epoch: scope.version,
                      title: label('save'),
                      description: `${label(slot.slotKey)}: ${slot.agent?.title ?? label('unassigned')} → ${selected?.title ?? label('unassigned')}. ${selected && !selected.enabled ? label('disabledHelp') : ''} ${shared.length ? `${label('shared')}: ${shared.join(locale === 'fa' ? '، ' : ', ')}. ` : ''}${label('confirm')}`,
                      path: `/api/admin/agent-slots/${slot.slotKey}/agent`,
                      method: 'PUT',
                      successStatus: 200,
                      body: { agentId },
                      forbiddenMessage: label('denied'),
                      conflictMessage: label('conflict'),
                    };
                    actionRef.current = next;
                    setAction(next);
                  }}
                />
              );
            })}
          </div>
        </ListPage.Content>
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          onDenied={scope.deny}
          onUnconfirmed={unconfirmed}
          onValidationError={(fields) => validationErrors.current?.(fields) ?? false}
          summary={recovery(true)}
          confirmationDisabled={
            !ready ||
            !!uncertainSlot ||
            action.epoch !== scope.version ||
            action.basis !== currentBasis
          }
          finalFocus={() => refreshButton.current}
          onClose={withdraw}
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
