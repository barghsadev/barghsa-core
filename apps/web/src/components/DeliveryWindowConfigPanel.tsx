import { notificationFormText } from '@barghsa/i18n/notification-forms';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import {
  DEFAULT_DELIVERY_WINDOW,
  formatWindowTime,
  type DeliveryWindowConfig,
} from '@barghsa/shared/notifications';
import { withCsrf } from '../lib/csrf.js';
import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { Alert, Button } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import type { Locale } from '@barghsa/i18n/app';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useCatalogueScope, useCatalogueResource } from '../hooks/useCatalogueResource.js';
import { catalogueRootMessage, CatalogueSaveButton } from './CatalogueEditorFeedback.js';
import {
  windowValues,
  windowBody,
  windowBasis,
  validWindow,
  windowInvalidFields,
  type WindowDraft,
} from '../lib/notification-form.js';
import { responseRecord } from '../lib/content-catalogues.js';

const TIMEZONE_OPTIONS = [
  'Asia/Tehran',
  'UTC',
  'Asia/Dubai',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
];
/** Newly scheduled daytime messages use this minute-precision window; existing schedules retain theirs. */
export default function DeliveryWindowConfigPanel({ uiLocale }: { uiLocale: Locale }) {
  const label = (key: string) => t(`admin.notifications.window.${key}`, uiLocale);
  const messages = {
    timezone: notificationFormText('timezone', uiLocale),
    startHour: notificationFormText('startHour', uiLocale),
    endHour: notificationFormText('endHour', uiLocale),
  };
  const editor = useWizardForm<WindowDraft>(
    async () => {
      const { notificationFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return notificationFormSchema(messages, windowInvalidFields);
    },
    () => windowValues(DEFAULT_DELIVERY_WINDOW),
    notificationFormText('validationUnavailable', uiLocale)
  );
  const applyErrors = useActionFieldErrors(editor.form, messages, messages.endHour);
  const [stale, setStale] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [recovered, setRecovered] = useState(false),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<{
    action: TeamAction;
    expected: DeliveryWindowConfig;
    generation: number;
  } | null>(null);
  const networkOwner = useRef(0);
  const generation = useRef(0),
    commandRef = useRef(command),
    basis = useRef<string | null>(null),
    refreshButton = useRef<HTMLButtonElement>(null),
    mounted = useRef(false),
    observed = useRef<DeliveryWindowConfig | null>(null);
  commandRef.current = command;
  const clearPrivate = useCallback(() => {
    generation.current++;
    editor.setValidationPending(false);
    networkOwner.current++;
    basis.current = null;
    commandRef.current = null;
    setCommand(null);
    editor.form.reset(windowValues(DEFAULT_DELIVERY_WINDOW));
    setStale(false);
    setUncertain(false);
    setSaved(false);
    setSaving(false);
    setError(null);
  }, [editor.form.reset]);
  const scope = useCatalogueScope(clearPrivate);
  const resource = useCatalogueResource(scope, '/api/admin/config/delivery-window', validWindow);
  const config = resource.data;
  const ready =
    !!config && !resource.loading && !resource.error && !scope.denied && !stale && !uncertain;
  const live = useRef({ ready, epoch: scope.version });
  live.current = { ready, epoch: scope.version };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (!config) return;
    if (config !== observed.current) {
      if (uncertain) setRecovered(true);
      observed.current = config;
    }
    const next = windowBasis(config);
    if (basis.current !== next) {
      generation.current++;
      commandRef.current = null;
      setCommand(null);
      if (basis.current !== null && editor.form.formState.isDirty) setStale(true);
      else if (!uncertain) editor.form.reset(windowValues(config));
      basis.current = next;
    }
  }, [config, editor.form.reset, editor.form.formState.isDirty, uncertain]);
  const current = (version: number, epoch: number) =>
    mounted.current && generation.current === version && scope.live.current === epoch;
  function refresh() {
    generation.current++;
    if (saving) {
      setUncertain(true);
      setRecovered(false);
    } else editor.setValidationPending(false);
    commandRef.current = null;
    setCommand(null);
    setSaved(false);
    setError(null);
    resource.retry();
  }
  function acceptSaved(result: unknown, expected: DeliveryWindowConfig) {
    if (!validWindow(result) || windowBasis(result) !== windowBasis(expected)) {
      setRecovered(false);
      setUncertain(true);
      throw new Error(label('saveFailed'));
    }
    resource.accept(result);
    basis.current = windowBasis(result);
    editor.form.reset(windowValues(result));
    setStale(false);
    setUncertain(false);
    setSaved(true);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!live.current.ready || editor.isPending() || commandRef.current) return;
    const version = generation.current,
      epoch = scope.version;
    editor.setValidationPending(true);
    setSaved(false);
    setError(null);
    try {
      const captured: { value?: WindowDraft } = {};
      await editor.form.handleSubmit((value) => {
        captured.value = value;
      })();
      if (captured.value) {
        const value = captured.value;
        if (!current(version, epoch) || !live.current.ready || commandRef.current) return;
        const expected = windowBody(value),
          body = {
            timezone: expected.timezone,
            start_hour: expected.startHour,
            end_hour: expected.endHour,
          };
        const owner = ++networkOwner.current;
        setSaving(true);
        try {
          const res = await fetch('/api/admin/config/delivery-window', {
            method: 'PUT',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
          });
          const result: unknown = await res.json().catch(() => null);
          if (!current(version, epoch)) return;
          const record = responseRecord(result),
            nested = responseRecord(record?.error),
            code = typeof record?.error === 'string' ? record.error : nested?.code;
          if (
            res.status === 403 &&
            (code === 'AUTHZ:STEP_UP_REQUIRED' || record?.requiresStepUp === true)
          ) {
            const next = {
              action: {
                title: label('title'),
                description: t('admin.notifications.confirmAction', uiLocale),
                path: '/api/admin/config/delivery-window',
                method: 'PUT' as const,
                body,
                requiresPassword: true,
              },
              expected,
              generation: version,
            };
            commandRef.current = next;
            setCommand(next);
            return;
          }
          if (res.status === 401 || res.status === 403) {
            scope.deny();
            return;
          }
          if (res.status === 400 && Array.isArray(nested?.fields) && applyErrors(nested.fields))
            return;
          if (!res.ok) throw new Error(label('saveFailed'));
          acceptSaved(result, expected);
        } catch {
          if (current(version, epoch)) setError(label('saveFailed'));
        } finally {
          if (owner === networkOwner.current) {
            setSaving(false);
            editor.setValidationPending(false);
            if (generation.current !== version) {
              setUncertain(true);
              setRecovered(false);
            }
          }
        }
      }
    } finally {
      if (generation.current === version) editor.setValidationPending(false);
    }
  }
  const feedback = (name: keyof WindowDraft) => (
    <p
      id={editor.errorId(name)}
      role={editor.errors[name] ? 'alert' : undefined}
      className={`min-h-5 text-sm text-destructive ${editor.errors[name] ? '' : 'invisible'}`}
    >
      {editor.errors[name]?.message ?? '\u00a0'}
    </p>
  );
  const busy = saving || editor.pending || !!command;
  return (
    <section
      aria-labelledby="delivery-window-title"
      className="bg-card text-card-foreground rounded-lg border border-border p-6 space-y-4"
    >
      <h2 id="delivery-window-title" className="text-lg font-semibold">
        {label('title')}
      </h2>
      <p className="text-sm text-muted-foreground">{label('description')}</p>
      <Button
        type="button"
        variant="outline"
        ref={refreshButton}
        disabled={resource.loading}
        onClick={() => (scope.denied ? scope.recover() : refresh())}
      >
        {notificationFormText('refresh', uiLocale)}
      </Button>
      {resource.loading && <p role="status">{label('loading')}</p>}
      {resource.error && <Alert variant="destructive">{label('loadFailed')}</Alert>}
      {scope.denied && (
        <Alert variant="destructive">{notificationFormText('denied', uiLocale)}</Alert>
      )}
      {uncertain && (
        <Alert variant="destructive">{notificationFormText('uncertain', uiLocale)}</Alert>
      )}
      {stale && <Alert variant="destructive">{notificationFormText('stale', uiLocale)}</Alert>}
      {(stale || uncertain) && (
        <Button
          type="button"
          variant="outline"
          disabled={
            !config || resource.loading || resource.error || busy || (uncertain && !recovered)
          }
          onClick={() => {
            if (config) {
              generation.current++;
              editor.form.reset(windowValues(config));
              setStale(false);
              setUncertain(false);
              setError(null);
            }
          }}
        >
          {notificationFormText('reset', uiLocale)}
        </Button>
      )}
      {!scope.denied && (
        <form onSubmit={submit} noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          {catalogueRootMessage(editor.errors) && (
            <Alert variant="destructive">{catalogueRootMessage(editor.errors)}</Alert>
          )}
          <fieldset disabled={!config || busy || stale || uncertain} className="space-y-4">
            <legend className="sr-only">{label('title')}</legend>
            <div>
              <label htmlFor="delivery-window-timezone" className="block text-sm font-medium mb-1">
                {label('timezone')}
              </label>
              <select
                id="delivery-window-timezone"
                {...editor.bind('timezone')}
                value={editor.values.timezone}
                onChange={(e) => {
                  setSaved(false);
                  editor.field('timezone')[1](e.target.value);
                }}
                className="w-full border border-input rounded px-3 py-2 bg-background"
              >
                {!TIMEZONE_OPTIONS.includes(editor.values.timezone) && (
                  <option value={editor.values.timezone}>{editor.values.timezone}</option>
                )}
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              {feedback('timezone')}
            </div>
            <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 gap-4">
              {(['startHour', 'endHour'] as const).map((name) => (
                <div key={name} className="min-w-0">
                  <label
                    htmlFor={`delivery-window-${name === 'startHour' ? 'start' : 'end'}`}
                    className="block text-sm font-medium mb-1"
                  >
                    {label(name === 'startHour' ? 'start' : 'end')}
                  </label>
                  <input
                    id={`delivery-window-${name === 'startHour' ? 'start' : 'end'}`}
                    type="time"
                    dir="ltr"
                    step="60"
                    {...editor.bind(name)}
                    value={editor.values[name]}
                    onChange={(e) => {
                      setSaved(false);
                      editor.field(name)[1](e.target.value);
                    }}
                    className="w-full min-w-0 border border-input rounded px-3 py-2 bg-background"
                  />
                  {feedback(name)}
                </div>
              ))}
            </div>
          </fieldset>
          {config && (
            <p className="text-xs text-muted-foreground my-3">
              {label('current')}:{' '}
              <span className="font-mono">
                {config.timezone} {formatWindowTime(config.startHour)}–
                {formatWindowTime(config.endHour)}
              </span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <CatalogueSaveButton
              pending={saving || editor.pending}
              disabled={!ready || busy}
              label={label(saving || editor.pending ? 'saving' : 'save')}
            />
            {saved && (
              <span role="status" className="text-sm text-success">
                {label('saved')}
              </span>
            )}
          </div>
        </form>
      )}
      {command && (
        <TeamActionDialog
          action={command.action}
          finalFocus={() => refreshButton.current}
          confirmationDisabled={!ready || command.generation !== generation.current}
          onDenied={scope.deny}
          onValidationError={applyErrors}
          summary={
            <Button type="button" variant="outline" disabled={resource.loading} onClick={refresh}>
              {notificationFormText('refresh', uiLocale)}
            </Button>
          }
          onClose={() => {
            if (commandRef.current === command) {
              commandRef.current = null;
              setCommand(null);
            }
          }}
          onSuccess={async (result) => {
            if (current(command.generation, scope.version)) acceptSaved(result, command.expected);
          }}
        />
      )}
    </section>
  );
}
