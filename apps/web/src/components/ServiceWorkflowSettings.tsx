import { CommandFeedback } from './CommandFeedback.js';
import { RecordCommandGuard } from './RecordCommandGuard.js';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import {
  LoadingStatus,
  Alert,
  Badge,
  Button,
  Input,
  Label,
  ListRefreshButton,
  NativeSelect,
} from '@barghsa/ui';
import { tServiceSettings } from '@barghsa/i18n/service-settings';
import {
  DEFAULT_SERVICE_WORKFLOWS,
  SERVICE_WORKFLOW_KEYS,
  isServiceWorkflowView,
  isServiceWorkflowPolicy,
  serviceWorkflowBasis,
  type ServiceWorkflowKey,
  type ServiceWorkflowView,
  type ServiceWorkflowPolicy,
  type WorkflowAudience,
  type ServiceWorkflowTarget,
} from '@barghsa/shared/admin';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { tWorkspace } from '@barghsa/i18n/workspace-admin';
import {
  RecordEditorActions,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from './RecordEditorLayout.js';
import { useSettingsSnapshot } from '../hooks/useSettingsSnapshot.js';
import { useCatalogueResource } from '../hooks/useCatalogueResource.js';
import { boundedCatalogueInteger } from '../lib/catalogue-form.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import type { CatalogueEditorProps } from '../hooks/useCatalogueEditor.js';

const path = '/api/admin/config/service-workflows';
const workflowGroups = [
  ['ticketWorkflows', ['ticket_urgent', 'ticket_high', 'ticket_normal', 'ticket_low']],
  [
    'requestWorkflows',
    ['verification', 'consultation', 'electricity_order', 'saving_order', 'solar_order'],
  ],
  ['contractWorkflows', ['electricity_contract', 'saving_contract', 'solar_contract']],
] as const satisfies readonly (readonly [string, readonly ServiceWorkflowKey[]])[];
type Revision = { id: string; version: number; value: ServiceWorkflowPolicy };
type RevisionPage = { items: Revision[]; nextBeforeVersion: number | null };
type WorkflowAction = TeamAction & { reviewedPolicy: ServiceWorkflowPolicy };
const revisionVersion = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
function isRevisionPage(value: unknown): value is RevisionPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as RevisionPage;
  return (
    Array.isArray(page.items) &&
    page.items.length <= 20 &&
    (page.nextBeforeVersion === null || revisionVersion(page.nextBeforeVersion)) &&
    page.items.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.id) &&
        revisionVersion(item.version) &&
        isServiceWorkflowPolicy(item.value)
    )
  );
}
const basis = (v: ServiceWorkflowView) =>
  JSON.stringify([v.version, serviceWorkflowBasis(v.policy), v.roles, v.teams]);
type Duration = { value: string; unit: 'hours' | 'days' };
type Times = Record<ServiceWorkflowKey, { target: Duration; rule: Duration }>;
const duration = (hours: number): Duration =>
  hours % 24 === 0
    ? { value: String(hours / 24), unit: 'days' }
    : { value: String(hours), unit: 'hours' };
const times = (policy: ServiceWorkflowPolicy): Times =>
  Object.fromEntries(
    SERVICE_WORKFLOW_KEYS.map((key) => [
      key,
      {
        target: duration(policy[key]?.hours ?? 24),
        rule: duration(policy[key]?.escalation?.afterHours ?? 24),
      },
    ])
  ) as Times;
const parse = (d: Duration) => {
  const n = boundedCatalogueInteger(d.value, 1, 8760);
  return n !== null && n * (d.unit === 'days' ? 24 : 1) <= 8760
    ? n * (d.unit === 'days' ? 24 : 1)
    : null;
};
export function ServiceWorkflowSettings({
  disabled = false,
  onBusyChange,
  onDenied,
  showComparison = false,
  heading,
  workflow,
}: CatalogueEditorProps & {
  showComparison?: boolean;
  heading?: ReactNode;
  workflow?: ServiceWorkflowKey;
}) {
  const locale = useLocale(),
    text = (key: string) => tServiceSettings(`workflow.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  const [draft, setDraft] = useState<ServiceWorkflowPolicy>(
    structuredClone(DEFAULT_SERVICE_WORKFLOWS)
  );
  const [raw, setRaw] = useState<Times>(() => times(DEFAULT_SERVICE_WORKFLOWS));
  const [localSelection, setSelected] = useState<ServiceWorkflowKey>('ticket_urgent');
  const selected = workflow ?? localSelection;
  const overview = !!heading && !workflow;
  const SectionHeading = workflow ? 'h2' : 'h3';
  const [action, setAction] = useState<WorkflowAction | null>(null),
    [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false),
    [saved, setSaved] = useState(false);
  const [invalidField, setInvalidField] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<{ version: number; before: number } | null>(
    null
  );
  const epoch = useRef(0),
    captured = useRef(0),
    actionRef = useRef(action),
    refreshRef = useRef<HTMLButtonElement>(null);
  actionRef.current = action;
  const withdraw = useCallback(() => {
    epoch.current++;
    setAction(null);
    setPending(false);
  }, []);
  const reset = useCallback((v: ServiceWorkflowView | null) => {
    const p = v?.policy ?? structuredClone(DEFAULT_SERVICE_WORKFLOWS);
    setDraft(p);
    setRaw(times(p));
    setInvalid(false);
    setSaved(false);
  }, []);
  const state = useSettingsSnapshot(path, isServiceWorkflowView, basis, reset, withdraw, onDenied);
  const version = state.current?.version ?? 0;
  const before =
    historyCursor && historyCursor.version === version ? historyCursor.before : version;
  const history = useCatalogueResource(
    { ...state.scope, deny: state.denyCommand },
    historyOpen && before > 1 ? `${path}/history?beforeVersion=${before}` : null,
    isRevisionPage
  );
  const busy = pending || !!action,
    blocked = disabled || !state.ready || state.changed || state.uncertain;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  function edit(target: ServiceWorkflowTarget | null) {
    setDraft({ ...draft, [selected]: target });
    setInvalid(false);
    setSaved(false);
  }
  function proposal() {
    const p = structuredClone(draft);
    for (const key of SERVICE_WORKFLOW_KEYS)
      if (p[key]) {
        const h = parse(raw[key].target),
          r = parse(raw[key].rule);
        if (h === null || (p[key]!.escalation && r === null)) return { policy: null, key };
        p[key]!.hours = h;
        if (p[key]!.escalation) p[key]!.escalation!.afterHours = r!;
        const rule = p[key]!.escalation;
        const known = (a: WorkflowAudience) =>
          a.kind === 'any' ||
          a.kind === 'admins' ||
          (a.kind === 'role' ? state.current?.roles : state.current?.teams)?.some(
            (o) => o.id === a.id
          );
        if (
          !isServiceWorkflowPolicy({ ...DEFAULT_SERVICE_WORKFLOWS, [key]: p[key] }) ||
          (rule && (!known(rule.from) || !known(rule.to)))
        )
          return { policy: null, key };
      }
    return { policy: isServiceWorkflowPolicy(p) ? p : null, key: selected };
  }
  function prepare() {
    if (blocked || busy || !state.current) return;
    const { policy, key } = proposal();
    if (!policy) {
      setInvalid(true);
      if (workflow && workflow !== key) {
        requestAnimationFrame(() => document.getElementById('workflow-error')?.focus());
        return;
      }
      setSelected(key);
      const r = draft[key]?.escalation;
      let id = `workflow-hours-${key}`;
      if (parse(raw[key].target) !== null) {
        if (r && parse(raw[key].rule) === null) id = `workflow-timeout-${key}`;
        else if (r) {
          for (const side of ['to', 'from'] as const) {
            const a = r[side];
            if (
              (a.kind === 'role' || a.kind === 'team') &&
              !(a.kind === 'role' ? state.current.roles : state.current.teams).some(
                (o) => o.id === a.id
              )
            )
              id = `workflow-${side}-reference`;
          }
        } else id = 'workflow-notification';
      }
      setInvalidField(id);
      requestAnimationFrame(() => document.getElementById(id)?.focus());
      return;
    }
    captured.current = epoch.current;
    setSaved(false);
    setInvalid(false);
    setAction({
      path,
      method: 'PUT',
      requiresPassword: true,
      title: text('save'),
      description: text('confirm'),
      body: { policy, expectedVersion: state.current.version },
      reviewedPolicy: policy,
      forbiddenMessage: text('forbidden'),
      conflictMessage: text('changed'),
    });
  }
  function prepareRestore(revision: Revision) {
    if (
      blocked ||
      busy ||
      !state.current ||
      history.loading ||
      history.error ||
      revision.version >= before
    )
      return;
    captured.current = epoch.current;
    setSaved(false);
    setInvalid(false);
    setAction({
      path: `${path}/restore`,
      method: 'POST',
      requiresPassword: true,
      title: text('restoreVersion').replace('{version}', String(revision.version)),
      description: text('restoreConfirm'),
      body: { sourceId: revision.id, expectedVersion: state.current.version },
      reviewedPolicy: revision.value,
      forbiddenMessage: text('forbidden'),
      conflictMessage: text('changed'),
    });
  }
  const target = draft[selected],
    rule = target?.escalation;
  function timeInput(part: 'target' | 'rule', label: string) {
    const id = part === 'target' ? `workflow-hours-${selected}` : `workflow-timeout-${selected}`;
    const value = raw[selected][part];
    const change = (next: Duration) => {
      setRaw({ ...raw, [selected]: { ...raw[selected], [part]: next } });
      setSaved(false);
      setInvalid(false);
    };
    return (
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        <div className={`${recordEditorField} w-28`}>
          <Label htmlFor={id}>{text(label)}</Label>
          <Input
            id={id}
            dir="ltr"
            inputMode="numeric"
            aria-required="true"
            value={value.value}
            aria-invalid={(invalid && invalidField === id) || undefined}
            aria-describedby={invalid && invalidField === id ? 'workflow-error' : undefined}
            onChange={(e) => change({ ...value, value: e.target.value })}
          />
        </div>
        <div className={recordEditorField}>
          <Label htmlFor={`${id}-unit`}>
            {text('unit')}
            <span className="sr-only"> · {text(label)}</span>
          </Label>
          <NativeSelect
            id={`${id}-unit`}
            aria-required="true"
            className="w-full"
            value={value.unit}
            onChange={(e) => change({ ...value, unit: e.target.value as Duration['unit'] })}
          >
            <option value="hours">{text('hours')}</option>
            <option value="days">{text('days')}</option>
          </NativeSelect>
        </div>
      </div>
    );
  }
  function audienceInput(side: 'from' | 'to') {
    if (!target || !rule) return null;
    const a = rule[side],
      options = a.kind === 'role' ? (state.current?.roles ?? []) : (state.current?.teams ?? []);
    const update = (audience: WorkflowAudience) =>
      edit({ ...target, escalation: { ...rule, [side]: audience } });
    return (
      <fieldset className="min-w-0 space-y-2">
        <legend>{text(side)}</legend>
        <Label className="sr-only" htmlFor={`workflow-${side}`}>
          {text(side)}
        </Label>
        <NativeSelect
          id={`workflow-${side}`}
          aria-required="true"
          className="w-full"
          value={a.kind}
          onChange={(e) => {
            const kind = e.target.value as WorkflowAudience['kind'];
            update(kind === 'any' || kind === 'admins' ? { kind, id: null } : { kind, id: '' });
          }}
        >
          <option value={side === 'from' ? 'any' : 'admins'}>
            {text(side === 'from' ? 'any' : 'admins')}
          </option>
          <option value="role">{text('role')}</option>
          <option value="team">{text('team')}</option>
        </NativeSelect>
        {(a.kind === 'role' || a.kind === 'team') && (
          <>
            <Label className="sr-only" htmlFor={`workflow-${side}-reference`}>
              {text(side)} · {text(a.kind)}
            </Label>
            <NativeSelect
              id={`workflow-${side}-reference`}
              className="w-full"
              value={a.id}
              aria-invalid={(invalid && invalidField === `workflow-${side}-reference`) || undefined}
              aria-describedby={
                invalid && invalidField === `workflow-${side}-reference`
                  ? 'workflow-error'
                  : undefined
              }
              onChange={(e) => update({ ...a, id: e.target.value })}
              required
              aria-required="true"
            >
              <option value="">{text('choose')}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </>
        )}
      </fieldset>
    );
  }
  const audienceName = (a: WorkflowAudience) =>
    a.kind === 'role' || a.kind === 'team'
      ? ((a.kind === 'role' ? state.current?.roles : state.current?.teams)?.find(
          (o) => o.id === a.id
        )?.name ?? text('choose'))
      : text(a.kind);
  const summary = (
    p: ServiceWorkflowPolicy,
    keys: readonly ServiceWorkflowKey[] = SERVICE_WORKFLOW_KEYS
  ) => (
    <dl className="space-y-2">
      {keys.map((key) => (
        <div key={key}>
          <dt className="font-medium">{text(key)}</dt>
          <dd>
            {p[key]
              ? `${numbers.number(p[key]!.hours)} ${text('hours')} · ${text(p[key]!.notification)}${p[key]!.email ? ' · ' + text('email') : ''}`
              : text('disabled')}
          </dd>
          {p[key]?.escalation && (
            <dd className="text-sm">
              {text(p[key]!.escalation!.condition)} ·{' '}
              {numbers.number(p[key]!.escalation!.afterHours)} {text('hours')} ·
              {audienceName(p[key]!.escalation!.from)} → {audienceName(p[key]!.escalation!.to)}
              {p[key]!.escalation!.email ? ' · ' + text('email') : ''}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
  const reviewedDraft = !overview && state.current ? proposal() : null;
  const savedPolicy = state.current?.policy;
  const proposalPolicy = reviewedDraft?.policy;
  const hasChanges = !!(
    proposalPolicy &&
    state.current &&
    serviceWorkflowBasis(proposalPolicy) !== serviceWorkflowBasis(state.current.policy)
  );
  const invalidWorkflow =
    invalid && workflow && reviewedDraft?.key !== workflow ? reviewedDraft?.key : undefined;
  return (
    <section className="space-y-4" aria-label={text('title')} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {heading && <RecordCommandGuard blocked={() => pending || state.uncertain} />}
      <header className="flex min-w-0 items-end justify-between gap-3">
        {heading ?? (
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold">{text('title')}</h2>
            <p className="text-sm text-muted-foreground">{text('note')}</p>
          </div>
        )}
        <ListRefreshButton
          ref={refreshRef}
          label={text('refresh')}
          onClick={state.refresh}
          disabled={busy}
          refreshing={state.resource.loading}
        />
      </header>
      {overview && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{text('overviewHelp')}</p>
          <details className="text-sm text-muted-foreground">
            <summary className="w-fit cursor-pointer text-primary">{text('policyHelp')}</summary>
            <p className="mt-1">{text('note')}</p>
          </details>
        </div>
      )}
      {showComparison && !workflow && state.current && (
        <Badge variant="secondary">
          {text('savedVersion').replace('{version}', numbers.number(version))}
        </Badge>
      )}
      {state.resource.loading && <LoadingStatus>{text('loading')}</LoadingStatus>}
      {state.resource.error && <Alert variant="destructive">{text('error')}</Alert>}
      {state.scope.denied && <Alert variant="destructive">{text('forbidden')}</Alert>}
      <CommandFeedback message={saved ? text('saved') : null} />
      {(state.changed || state.uncertain) && (
        <Alert variant="destructive">
          <p>{text(state.uncertain ? 'unverified' : 'changed')}</p>
          {overview && (
            <Button
              type="button"
              variant="outline"
              className="mt-2 w-fit"
              onClick={state.resetSaved}
              disabled={busy || !state.ready || (state.uncertain && !state.recovered)}
            >
              {text('reset')}
            </Button>
          )}
        </Alert>
      )}
      {overview && savedPolicy && !state.scope.denied && (
        <div className="space-y-3">
          {workflowGroups.map(([title, keys]) => (
            <section
              key={title}
              className="rounded-xl border bg-card"
              aria-labelledby={`workflow-${title}`}
            >
              <h2
                id={`workflow-${title}`}
                className="border-b px-4 py-2.5 text-sm font-semibold sm:px-5"
              >
                {text(title)}
              </h2>
              <ul className="grid divide-y md:grid-cols-2 md:divide-y-0">
                {keys.map((key) => {
                  const entry = savedPolicy[key];
                  const limit = entry && duration(entry.hours);
                  return (
                    <li key={key} className="min-w-0 md:border-b md:odd:border-e">
                      <Link
                        to="/admin/service-targets/$section/{-$workflow}"
                        params={{ section: 'workflows', workflow: key }}
                        disabled={busy || state.uncertain}
                        className="touch-action flex min-h-12 min-w-0 items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/45 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5"
                      >
                        <span className="min-w-0 flex-1 font-medium">{text(key)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {limit
                            ? numbers.number(Number(limit.value)) + ' ' + text(limit.unit)
                            : text('noCustomTarget')}
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {!overview && state.current && !state.scope.denied && (
        <form
          noValidate
          className={recordEditorSurface}
          aria-label={text('title')}
          onSubmit={(e) => {
            e.preventDefault();
            prepare();
          }}
        >
          {invalid && (
            <Alert id="workflow-error" tabIndex={-1} variant="destructive" className="m-4">
              {invalidWorkflow ? (
                <Link
                  to="/admin/service-targets/$section/{-$workflow}"
                  params={{ section: 'workflows', workflow: invalidWorkflow }}
                  className="underline underline-offset-4"
                >
                  {text('checkOtherWorkflow').replace('{workflow}', text(invalidWorkflow))}
                </Link>
              ) : (
                text('invalid')
              )}
            </Alert>
          )}
          <fieldset className="m-0 min-w-0 border-0 p-0" disabled={blocked || busy}>
            <div className="space-y-2 px-4 py-3 sm:px-6">
              {!workflow && (
                <div className={recordEditorField}>
                  <Label htmlFor="workflow-select">{text('select')}</Label>
                  <NativeSelect
                    id="workflow-select"
                    className="w-full"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value as ServiceWorkflowKey)}
                  >
                    {SERVICE_WORKFLOW_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {text(key)}
                        {draft[key] ? '' : ' · ' + text('disabled')}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              <label className="touch-label flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!target}
                  onChange={(e) =>
                    edit(
                      e.target.checked
                        ? { hours: 24, notification: 'breach', email: false, escalation: null }
                        : null
                    )
                  }
                />
                {text('enabled')}
              </label>
              {workflow?.startsWith('ticket_') && (
                <p className="text-sm text-muted-foreground">{text('ticketTargetHelp')}</p>
              )}
              {workflow && !target && (
                <p className="text-sm text-muted-foreground">{text('enableTargetHelp')}</p>
              )}
            </div>
            {target && (
              <>
                <section
                  aria-labelledby="workflow-response-heading"
                  className="space-y-2 border-t px-4 py-3 sm:px-6"
                >
                  <SectionHeading id="workflow-response-heading" className="font-semibold">
                    {text('responseSettings')}
                  </SectionHeading>
                  <div className={recordEditorGrid}>
                    {timeInput('target', 'threshold')}
                    <div className={recordEditorField}>
                      <Label htmlFor="workflow-notification">{text('notification')}</Label>
                      <NativeSelect
                        id="workflow-notification"
                        aria-required="true"
                        className="w-full"
                        value={target.notification}
                        onChange={(e) =>
                          edit({
                            ...target,
                            notification: e.target.value as ServiceWorkflowTarget['notification'],
                          })
                        }
                      >
                        <option value="breach">{text('breach')}</option>
                        <option value="escalation">{text('escalation')}</option>
                      </NativeSelect>
                    </div>
                  </div>
                  <label className="touch-label flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={target.email}
                      onChange={(e) => edit({ ...target, email: e.target.checked })}
                    />
                    {text('email')}
                  </label>
                </section>
                <section
                  aria-labelledby="workflow-escalation-heading"
                  className="space-y-2 border-t px-4 py-3 sm:px-6"
                >
                  <SectionHeading id="workflow-escalation-heading" className="font-semibold">
                    {text('escalationSettings')}
                  </SectionHeading>
                  <label className="touch-label flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!rule}
                      onChange={(e) =>
                        edit({
                          ...target,
                          escalation: e.target.checked
                            ? {
                                condition: 'sla_breached',
                                from: { kind: 'any', id: null },
                                to: { kind: 'admins', id: null },
                                afterHours: 24,
                                email: false,
                              }
                            : null,
                        })
                      }
                    />
                    {text('rule')}
                  </label>
                  {rule && (
                    <div className="space-y-3 rounded-lg bg-muted/40 p-3">
                      <div className={`${recordEditorField} max-w-md`}>
                        <Label htmlFor="workflow-condition">{text('condition')}</Label>
                        <NativeSelect
                          id="workflow-condition"
                          aria-required="true"
                          className="w-full"
                          value={rule.condition}
                          onChange={(e) =>
                            edit({
                              ...target,
                              escalation: {
                                ...rule,
                                condition: e.target.value as typeof rule.condition,
                              },
                            })
                          }
                        >
                          <option value="sla_breached">{text('sla_breached')}</option>
                          {selected.startsWith('ticket_') && (
                            <option value="ticket_priority">{text('ticket_priority')}</option>
                          )}
                        </NativeSelect>
                      </div>
                      <div className={recordEditorGrid}>
                        {audienceInput('from')}
                        {audienceInput('to')}
                      </div>
                      {timeInput('rule', 'timeout')}
                      <label className="touch-label flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={rule.email}
                          onChange={(e) =>
                            edit({ ...target, escalation: { ...rule, email: e.target.checked } })
                          }
                        />
                        {text('email')}
                      </label>
                    </div>
                  )}
                  {workflow ? (
                    rule && (
                      <details className="text-sm text-muted-foreground">
                        <summary className="w-fit cursor-pointer text-primary">
                          {text('timingHelp')}
                        </summary>
                        <p className="mt-2">{text('timing')}</p>
                      </details>
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">{text('timing')}</p>
                  )}
                </section>
              </>
            )}
          </fieldset>
          {showComparison && (!workflow || hasChanges) && (
            <section
              aria-labelledby="workflow-preview-heading"
              className="space-y-2 border-t px-4 py-3 sm:px-6"
            >
              <SectionHeading id="workflow-preview-heading" className="font-semibold">
                {text('reviewCurrent')}
              </SectionHeading>
              <div className="grid min-w-0 overflow-hidden rounded-lg border text-sm sm:grid-cols-2">
                <div className="min-w-0 space-y-1 px-3 py-2.5">
                  <p className="text-sm text-muted-foreground">
                    {tWorkspace('admin.settings.current', locale)}
                  </p>
                  {summary(state.current.policy, [selected])}
                </div>
                <div className="min-w-0 space-y-1 border-t bg-primary/5 px-3 py-2.5 sm:border-s sm:border-t-0">
                  <p className="text-sm text-muted-foreground">
                    {tWorkspace('admin.settings.draft', locale)}
                  </p>
                  {proposalPolicy ? (
                    summary(proposalPolicy, [selected])
                  ) : (
                    <p className="text-sm text-muted-foreground">{text('reviewPending')}</p>
                  )}
                </div>
              </div>
            </section>
          )}
          <RecordEditorActions>
            {(!workflow || hasChanges || invalid || state.changed || state.uncertain) && (
              <Button
                type="button"
                variant="outline"
                onClick={state.resetSaved}
                disabled={busy || !state.ready || (state.uncertain && !state.recovered)}
              >
                {text('reset')}
              </Button>
            )}
            <Button type="submit" disabled={blocked || busy || (!!proposalPolicy && !hasChanges)}>
              {text(workflow ? 'reviewChanges' : 'save')}
            </Button>
          </RecordEditorActions>
        </form>
      )}
      {!workflow && state.current && version > 1 && !state.scope.denied && (
        <section className="space-y-3" aria-label={text('history')}>
          <Button
            type="button"
            variant="outline"
            aria-expanded={historyOpen}
            disabled={busy}
            onClick={() => {
              setHistoryCursor(null);
              setHistoryOpen(!historyOpen);
            }}
          >
            {text('history')}
          </Button>
          {historyOpen && (
            <>
              {history.loading && <LoadingStatus>{text('loading')}</LoadingStatus>}
              {history.error && (
                <Alert variant="destructive">
                  {text('historyError')}{' '}
                  <Button type="button" variant="outline" onClick={history.retry}>
                    {text('refresh')}
                  </Button>
                </Alert>
              )}
              {history.data && !history.loading && !history.error && (
                <>
                  {history.data.items.length === 0 && <p>{text('historyEmpty')}</p>}
                  <ul className="flex flex-wrap gap-2">
                    {history.data.items
                      .filter((revision) => revision.version < before)
                      .map((revision) => (
                        <li key={revision.id}>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={blocked || busy}
                            onClick={() => prepareRestore(revision)}
                          >
                            {text('restoreVersion').replace('{version}', String(revision.version))}
                          </Button>
                        </li>
                      ))}
                  </ul>
                  {history.data.nextBeforeVersion !== null &&
                    history.data.nextBeforeVersion < before && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const cursor = history.data?.nextBeforeVersion;
                          if (cursor) setHistoryCursor({ version, before: cursor });
                        }}
                      >
                        {text('historyOlder')}
                      </Button>
                    )}
                </>
              )}
            </>
          )}
        </section>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          toastErrors={!heading}
          finalFocus={refreshRef}
          confirmationDisabled={blocked || state.uncertain}
          onClose={withdraw}
          onPendingChange={setPending}
          onDenied={state.denyCommand}
          onUnconfirmed={state.unconfirmed}
          summary={summary(action.reviewedPolicy, workflow ? [workflow] : SERVICE_WORKFLOW_KEYS)}
          onSuccess={async (result) => {
            if (captured.current !== epoch.current || actionRef.current !== action) return;
            if (
              !isServiceWorkflowView(result) ||
              !state.current ||
              result.version !== state.current.version + 1 ||
              serviceWorkflowBasis(result.policy) !== serviceWorkflowBasis(action.reviewedPolicy)
            ) {
              state.unconfirmed();
              throw new Error('Unconfirmed workflow policy');
            }
            if (state.accept(result)) {
              setAction(null);
              setSaved(true);
            }
          }}
        />
      )}
      {!heading && <p className="text-sm text-muted-foreground">{text('legacy')}</p>}
    </section>
  );
}
