import { Pencil as TablePencilIcon } from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { useCompactRecords } from '../hooks/useCompactRecords.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Badge,
  LoadingStatus,
  Alert,
  Button,
  ListPage,
  ListRefreshButton,
  ScrollArea,
  buttonVariants,
} from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { aiAgentFormText } from '@barghsa/i18n/ai-agent-forms';
import { AgentSlotChoiceForm } from '../components/AgentSlotChoiceForm.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useLocale } from '../hooks/useLocale.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { toast } from '../lib/toast-api.js';
import {
  isAgentSlots,
  isAssignmentAgents,
  isAgentSlot,
  slotBasis,
  type AgentSlot,
  type SlotKey,
} from '../lib/assignment-settings.js';

type AssignmentReview = TeamAction & {
  slotKey: SlotKey;
  agentId: string | null;
  basis: string;
  epoch: number;
};
type SlotWorkspace =
  | { view: 'list'; slotKey?: never }
  | { view: 'detail' | 'edit'; slotKey: SlotKey; showAssignment: (replace?: boolean) => void };
const slotRoute = (slotKey: SlotKey, action?: 'edit') => ({
  to: '/admin/agent-slots/$slotKey/{-$action}' as const,
  params: { slotKey, action },
});

export default function AdminAgentSlotsPage({ workspace }: { workspace?: SlotWorkspace } = {}) {
  const compact = useCompactRecords();
  const locale = useLocale(),
    label = (key: string) => t(`admin.slots.${key}`, locale);
  const time = useAccountTime(locale);
  const [choices, setChoices] = useState<Partial<Record<SlotKey, { id: string; basis: string }>>>(
    {}
  );
  const [action, setAction] = useState<AssignmentReview | null>(null),
    [saved, setSaved] = useState(false);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
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
  const needsAgents = !workspace || workspace.view === 'edit';
  const agents = useCatalogueResource(
    scope,
    needsAgents ? '/api/admin/agents' : null,
    isAssignmentAgents
  );
  useEffect(() => {
    if (workspace?.slotKey) heading.current?.focus({ preventScroll: true });
  }, [workspace?.slotKey, workspace?.view]);
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
      {!scope.denied && needsAgents && (
        <div className="space-y-2">
          {agents.loading && <LoadingStatus>{label('agentsLoading')}</LoadingStatus>}
          {agents.error && <p role="alert">{label('agentsError')}</p>}
          <Button type="button" variant="outline" disabled={agents.loading} onClick={refreshAgents}>
            {label('agentsRetry')}
          </Button>
        </div>
      )}
    </div>
  );
  const slot = workspace?.slotKey
    ? slots.data?.find((record) => record.slotKey === workspace.slotKey)
    : undefined;
  const isEditor = workspace?.view === 'edit';
  const renderSlotForm = (slot: AgentSlot) => {
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
        savedAt={isEditor ? time.format(slot.updatedAt) : undefined}
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
          if (!current(epoch) || !ready || stale || actionRef.current || uncertainSlot) return;
          setSaved(false);
          validationErrors.current = errors;
          const next: AssignmentReview = {
            slotKey: slot.slotKey,
            agentId,
            basis: reviewBasis(slot.slotKey, agentId),
            epoch: scope.version,
            ...(!agentId ? { risk: 'destructive' as const } : {}),
            title: label('save'),
            description: `${label(slot.slotKey)}: ${slot.agent?.title ?? label('unassigned')} → ${selected?.title ?? label('unassigned')}. ${selected && !selected.enabled ? label('disabledHelp') : ''} ${shared.length ? `${label('shared')}: ${shared.join(locale === 'fa' ? '، ' : ', ')}. ` : ''}${label('confirm')}`,
            path: `/api/admin/agent-slots/${slot.slotKey}/agent`,
            method: 'PUT',
            responseDeadline: true,
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
  };
  const assignment = (agent: AgentSlot['agent']) => (
    <div className="space-y-2 text-sm">
      <p className="font-medium [overflow-wrap:anywhere]">
        {agent ? <bdi>{agent.title}</bdi> : label('unassigned')}
      </p>
      {agent && (
        <Badge variant="secondary">{label(agent.enabled ? 'eligibleAgent' : 'disabled')}</Badge>
      )}
    </div>
  );
  return (
    <section
      className={`mx-auto flex w-full min-w-0 flex-col py-4 md:px-8 ${isEditor ? 'max-w-3xl gap-4 sm:px-4' : 'max-w-6xl gap-6 px-4 md:py-8'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          {workspace?.slotKey && (
            <Link
              {...(isEditor ? slotRoute(workspace.slotKey) : { to: '/admin/agent-slots' as const })}
              className="mb-2 inline-flex text-sm text-primary underline-offset-4 hover:underline"
            >
              {label(isEditor ? 'viewSlot' : 'title')}
            </Link>
          )}
          <h1
            ref={heading}
            data-slot="editor-heading"
            tabIndex={workspace?.slotKey ? -1 : undefined}
            className="text-2xl font-semibold outline-none!"
          >
            {label(workspace?.slotKey ?? 'title')}
          </h1>
          {(!workspace || workspace.view === 'list') && (
            <p className="mt-1 text-sm text-muted-foreground">{label('description')}</p>
          )}
        </div>
        {isEditor && (
          <ListRefreshButton
            ref={refreshButton}
            label={label('refresh')}
            disabled={slots.loading || agents.loading}
            onClick={() => {
              refreshSlots();
              if (!scope.denied) refreshAgents();
            }}
          />
        )}
      </header>
      {time.notice}
      <CommandFeedback message={saved ? label('saved') : null} />
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
        {!isEditor && <ListPage.Toolbar>{recovery()}</ListPage.Toolbar>}
        {isEditor && !scope.denied && agents.loading && (
          <LoadingStatus>{label('agentsLoading')}</LoadingStatus>
        )}
        {isEditor && !scope.denied && agents.error && (
          <Alert variant="destructive">
            <p>{label('agentsError')}</p>
            <Button type="button" variant="outline" onClick={refreshAgents}>
              {label('agentsRetry')}
            </Button>
          </Alert>
        )}
        <ListPage.Content
          loading={slots.loading}
          error={slots.error || scope.denied}
          empty={false}
          emptyView={null}
          retainContent={slots.data !== null}
          loadingView={
            workspace?.view === 'detail' ? (
              <RecordDetailSkeleton label={label('loading')} />
            ) : (
              <RecordListSkeleton
                label={label('loading')}
                view={compact ? 'card' : 'table'}
                headings={[copy('slot'), label('current'), copy('lastChanged'), copy('assignment')]}
              />
            )
          }
          errorView={<p role="alert">{label(scope.denied ? 'denied' : 'error')}</p>}
        >
          {slot && workspace?.view === 'detail' && (
            <div className="max-w-3xl space-y-4 rounded-xl border bg-card p-4 sm:p-6">
              <h2 className="font-semibold">{label('current')}</h2>
              {assignment(slot.agent)}
              <dl className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">{copy('lastChanged')}</dt>
                  <dd>
                    <time dateTime={slot.updatedAt}>{time.format(slot.updatedAt)}</time>
                  </dd>
                </div>
                {slot.alsoUsedIn.length > 0 && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{label('shared')}</dt>
                    <dd>
                      {slot.alsoUsedIn.map((key) => label(key)).join(locale === 'fa' ? '، ' : ', ')}
                    </dd>
                  </div>
                )}
              </dl>
              {!slot.agent?.enabled && (
                <p className="text-sm text-muted-foreground">{label('fallback')}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {!slots.loading && !slots.error && (
                  <Link
                    {...slotRoute(slot.slotKey, 'edit')}
                    className={buttonVariants({ className: 'min-h-11' })}
                  >
                    {label('edit')}
                  </Link>
                )}
                {slot.agent && (
                  <Link
                    to="/admin/agents/$agentId/{-$action}"
                    params={{ agentId: slot.agent.id, action: undefined }}
                    className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                  >
                    {label('viewAgent')}
                  </Link>
                )}
              </div>
            </div>
          )}
          {slot && isEditor && renderSlotForm(slot)}
          {(!workspace || workspace.view === 'list') && (
            <ScrollArea
              scrollbarOrientation="horizontal"
              className="max-w-full min-w-0 rounded-lg border bg-background [&>[data-slot=scroll-area-viewport]]:relative"
              role="region"
              aria-label={copy('slotsTable')}
            >
              <table className="w-full text-start text-sm md:min-w-[42rem]">
                <colgroup className="hidden md:table-column-group">
                  <col className="w-[170px]" />
                  <col className="w-[180px]" />
                  <col className="w-[190px]" />
                  <col />
                  {workspace && <col />}
                </colgroup>
                <thead className="border-b bg-muted">
                  <tr>
                    {[copy('slot'), label('current'), copy('lastChanged'), copy('assignment')].map(
                      (name, index) => (
                        <th
                          key={name}
                          scope="col"
                          className={`${index < 3 ? 'hidden md:table-cell ' : ''}p-4 text-start font-semibold`}
                        >
                          {name}
                        </th>
                      )
                    )}
                    {workspace && (
                      <th scope="col" data-table-actions="" className="p-4 font-semibold">
                        {label('edit')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {slots.data?.map((slot) => {
                    return (
                      <tr key={slot.slotKey} className="border-b align-top last:border-0">
                        <th
                          scope="row"
                          className="hidden p-4 text-start font-semibold md:table-cell"
                        >
                          {workspace ? (
                            <Link
                              {...slotRoute(slot.slotKey)}
                              className="font-medium text-primary underline-offset-4 hover:underline"
                            >
                              {label(slot.slotKey)}
                            </Link>
                          ) : (
                            label(slot.slotKey)
                          )}
                        </th>
                        <td className="hidden break-words p-4 md:table-cell" dir="auto">
                          {slot.agent?.title ?? label('unassigned')}
                        </td>
                        <td className="hidden p-4 md:table-cell">
                          <time dateTime={slot.updatedAt}>{time.format(slot.updatedAt)}</time>
                        </td>
                        <td className="p-4">
                          {workspace && (
                            <Link
                              {...slotRoute(slot.slotKey)}
                              className="mb-2 flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline md:hidden"
                            >
                              {label(slot.slotKey)}
                            </Link>
                          )}
                          <dl className="mb-4 space-y-2 text-sm md:hidden">
                            <div>
                              <dt className="font-medium">{label('current')}</dt>
                              <dd className="break-words" dir="auto">
                                {slot.agent?.title ?? label('unassigned')}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-medium">{copy('lastChanged')}</dt>
                              <dd>{time.format(slot.updatedAt)}</dd>
                            </div>
                          </dl>
                          {workspace
                            ? (!slot.agent || !slot.agent.enabled) && (
                                <p className="text-sm text-muted-foreground">{label('fallback')}</p>
                              )
                            : renderSlotForm(slot)}
                        </td>
                        {workspace && (
                          <td data-table-actions="" className="p-4">
                            {!slots.loading && !slots.error && (
                              <Link
                                {...slotRoute(slot.slotKey, 'edit')}
                                className={buttonVariants({
                                  variant: 'outline',
                                  className: 'min-h-11',
                                })}
                                aria-label={`${label('edit')} · ${label(slot.slotKey)}`}
                                data-table-action-tooltip={label('edit')}
                              >
                                <TableActionIcon icon={TablePencilIcon}>
                                  {label('edit')}
                                </TableActionIcon>
                              </Link>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          )}
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
            if (workspace?.view === 'edit') {
              toast.success(label('saved'));
              workspace.showAssignment(true);
              return;
            }
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
