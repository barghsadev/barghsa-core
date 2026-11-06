import { useCallback, useEffect, useRef, useState } from 'react';
import { LoadingStatus, Alert, Button, Input, Label } from '@barghsa/ui';
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
import { useSettingsSnapshot } from '../hooks/useSettingsSnapshot.js';
import { boundedCatalogueInteger } from '../lib/catalogue-form.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import type { CatalogueEditorProps } from '../hooks/useCatalogueEditor.js';

const path = '/api/admin/config/service-workflows';
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
export function ServiceWorkflowSettings({ disabled = false, onBusyChange }: CatalogueEditorProps) {
  const locale = useLocale(),
    text = (key: string) => tServiceSettings(`workflow.${key}`, locale);
  const [draft, setDraft] = useState<ServiceWorkflowPolicy>(
    structuredClone(DEFAULT_SERVICE_WORKFLOWS)
  );
  const [raw, setRaw] = useState<Times>(() => times(DEFAULT_SERVICE_WORKFLOWS));
  const [selected, setSelected] = useState<ServiceWorkflowKey>('ticket_urgent');
  const [action, setAction] = useState<TeamAction | null>(null),
    [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false),
    [saved, setSaved] = useState(false);
  const [invalidField, setInvalidField] = useState('');
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
  const state = useSettingsSnapshot(path, isServiceWorkflowView, basis, reset, withdraw);
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
      forbiddenMessage: text('forbidden'),
      conflictMessage: text('changed'),
    });
  }
  const target = draft[selected],
    rule = target?.escalation;
  const inputClass = 'h-10 w-full min-w-0 rounded-md border bg-background px-3 text-foreground';
  function timeInput(part: 'target' | 'rule', label: string) {
    const id = part === 'target' ? `workflow-hours-${selected}` : `workflow-timeout-${selected}`;
    const value = raw[selected][part];
    const change = (next: Duration) => {
      setRaw({ ...raw, [selected]: { ...raw[selected], [part]: next } });
      setSaved(false);
      setInvalid(false);
    };
    return (
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={id}>{text(label)}</Label>
          <Input
            id={id}
            dir="ltr"
            inputMode="numeric"
            value={value.value}
            aria-invalid={(invalid && invalidField === id) || undefined}
            aria-describedby={invalid && invalidField === id ? 'workflow-error' : undefined}
            onChange={(e) => change({ ...value, value: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-unit`}>
            {text('unit')} · {text(label)}
          </Label>
          <select
            id={`${id}-unit`}
            className={inputClass}
            value={value.unit}
            onChange={(e) => change({ ...value, unit: e.target.value as Duration['unit'] })}
          >
            <option value="hours">{text('hours')}</option>
            <option value="days">{text('days')}</option>
          </select>
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
        <select
          id={`workflow-${side}`}
          className={inputClass}
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
        </select>
        {(a.kind === 'role' || a.kind === 'team') && (
          <>
            <Label className="sr-only" htmlFor={`workflow-${side}-reference`}>
              {text(side)} · {text(a.kind)}
            </Label>
            <select
              id={`workflow-${side}-reference`}
              className={inputClass}
              value={a.id}
              aria-invalid={(invalid && invalidField === `workflow-${side}-reference`) || undefined}
              aria-describedby={
                invalid && invalidField === `workflow-${side}-reference`
                  ? 'workflow-error'
                  : undefined
              }
              onChange={(e) => update({ ...a, id: e.target.value })}
              required
            >
              <option value="">{text('choose')}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
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
  const summary = (p: ServiceWorkflowPolicy) => (
    <dl className="space-y-2">
      {SERVICE_WORKFLOW_KEYS.map((key) => (
        <div key={key}>
          <dt className="font-medium">{text(key)}</dt>
          <dd>
            {p[key]
              ? `${p[key]!.hours} ${text('hours')} · ${text(p[key]!.notification)}${p[key]!.email ? ' · ' + text('email') : ''}`
              : text('disabled')}
          </dd>
          {p[key]?.escalation && (
            <dd className="text-sm">
              {text(p[key]!.escalation!.condition)} · {p[key]!.escalation!.afterHours}{' '}
              {text('hours')} ·{audienceName(p[key]!.escalation!.from)} →{' '}
              {audienceName(p[key]!.escalation!.to)}
              {p[key]!.escalation!.email ? ' · ' + text('email') : ''}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
  return (
    <section className="space-y-4" aria-label={text('title')} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h2 className="text-xl font-semibold">{text('title')}</h2>
      <p className="text-sm text-muted-foreground">{text('note')}</p>
      {state.resource.loading && <LoadingStatus>{text('loading')}</LoadingStatus>}
      {state.resource.error && <Alert variant="destructive">{text('error')}</Alert>}
      {state.scope.denied && <Alert variant="destructive">{text('forbidden')}</Alert>}
      {saved && <p role="status">{text('saved')}</p>}
      {(state.changed || state.uncertain) && (
        <Alert variant="destructive">{text(state.uncertain ? 'unverified' : 'changed')}</Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          ref={refreshRef}
          type="button"
          variant="outline"
          onClick={state.refresh}
          disabled={busy || state.resource.loading}
        >
          {text('refresh')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={state.resetSaved}
          disabled={busy || !state.ready || (state.uncertain && !state.recovered)}
        >
          {text('reset')}
        </Button>
      </div>
      {state.current && !state.scope.denied && (
        <form
          noValidate
          className="space-y-4"
          aria-label={text('title')}
          onSubmit={(e) => {
            e.preventDefault();
            prepare();
          }}
        >
          {invalid && (
            <Alert id="workflow-error" variant="destructive">
              {text('invalid')}
            </Alert>
          )}
          <fieldset className="min-w-0 space-y-4 rounded-md border p-4" disabled={blocked || busy}>
            <div className="space-y-2">
              <Label htmlFor="workflow-select">{text('select')}</Label>
              <select
                id="workflow-select"
                className={inputClass}
                value={selected}
                onChange={(e) => setSelected(e.target.value as ServiceWorkflowKey)}
              >
                {SERVICE_WORKFLOW_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {text(key)}
                    {draft[key] ? '' : ' · ' + text('disabled')}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex gap-2">
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
            {target && (
              <>
                {timeInput('target', 'threshold')}
                <div className="space-y-2">
                  <Label htmlFor="workflow-notification">{text('notification')}</Label>
                  <select
                    id="workflow-notification"
                    className={inputClass}
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
                  </select>
                </div>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={target.email}
                    onChange={(e) => edit({ ...target, email: e.target.checked })}
                  />
                  {text('email')}
                </label>
                <label className="flex gap-2">
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
                  <fieldset className="min-w-0 space-y-4 rounded-md border p-4">
                    <legend>{text('rule')}</legend>
                    <Label htmlFor="workflow-condition">{text('condition')}</Label>
                    <select
                      id="workflow-condition"
                      className={inputClass}
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
                    </select>
                    {audienceInput('from')}
                    {audienceInput('to')}
                    {timeInput('rule', 'timeout')}
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={rule.email}
                        onChange={(e) =>
                          edit({ ...target, escalation: { ...rule, email: e.target.checked } })
                        }
                      />
                      {text('email')}
                    </label>
                  </fieldset>
                )}
                <p className="text-sm text-muted-foreground">{text('timing')}</p>
              </>
            )}
          </fieldset>
          <Button
            type="submit"
            disabled={
              blocked ||
              busy ||
              (!!proposal().policy &&
                serviceWorkflowBasis(proposal().policy!) ===
                  serviceWorkflowBasis(state.current.policy))
            }
          >
            {text('save')}
          </Button>
        </form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          finalFocus={refreshRef}
          confirmationDisabled={blocked || state.uncertain}
          onClose={withdraw}
          onPendingChange={setPending}
          onDenied={state.scope.deny}
          onUnconfirmed={state.unconfirmed}
          summary={summary((action.body as { policy: ServiceWorkflowPolicy }).policy)}
          onSuccess={async (result) => {
            if (captured.current !== epoch.current || actionRef.current !== action) return;
            if (
              !isServiceWorkflowView(result) ||
              !state.current ||
              result.version !== state.current.version + 1 ||
              serviceWorkflowBasis(result.policy) !==
                serviceWorkflowBasis((action.body as { policy: ServiceWorkflowPolicy }).policy)
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
      <p className="text-sm text-muted-foreground">{text('legacy')}</p>
    </section>
  );
}
