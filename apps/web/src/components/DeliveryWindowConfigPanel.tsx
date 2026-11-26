import { CommandFeedback } from './CommandFeedback.js';
import { notificationFormText } from '@barghsa/i18n/notification-forms';
import { accountTimeInputText } from '@barghsa/i18n/account-time-input';
import { timezoneCityName, timezoneText } from '@barghsa/i18n/timezone';
import { tPreferenceSettingsForms } from '@barghsa/i18n/preference-settings-forms';
import { SearchIcon } from 'lucide-react';
import { RecordTimeInput } from './RecordTimeInput.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import {
  DEFAULT_DELIVERY_WINDOW,
  formatWindowTime,
  type DeliveryWindowConfig,
} from '@barghsa/shared/notifications';
import { withCsrf } from '../lib/csrf.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import {
  LoadingStatus,
  Alert,
  Button,
  ComboBox,
  ComboBoxInput,
  ComboBoxItem,
  ComboBoxPopup,
  Label,
  ListRefreshButton,
} from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import type { Locale } from '@barghsa/i18n/app';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useCatalogueScope, useCatalogueResource } from '../hooks/useCatalogueResource.js';
import {
  CatalogueFieldFeedback,
  catalogueRootMessage,
  CatalogueSaveButton,
  SettingsValueSkeleton,
} from './CatalogueEditorFeedback.js';
import {
  windowValues,
  windowBody,
  windowBasis,
  validWindow,
  windowInvalidFields,
  type WindowDraft,
} from '../lib/notification-form.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from './RecordEditorLayout.js';
import { responseRecord } from '../lib/content-catalogues.js';
import { ALL_TIMEZONES, timezoneSearchTerms } from '../lib/timezone-options.js';

/** Newly scheduled daytime messages use this minute-precision window; existing schedules retain theirs. */
export default function DeliveryWindowConfigPanel({
  uiLocale,
  onSessionEnded,
  headingLevel = 2,
}: {
  uiLocale: Locale;
  onSessionEnded?: () => void;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const profileRevision = useProfileContextRevision();
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
    [recoveryAttempt, setRecoveryAttempt] = useState<number | null>(null),
    [saving, setSaving] = useState(false),
    [protectedBusy, setProtectedBusy] = useState(false),
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
    write = useRef<AbortController | null>(null);
  commandRef.current = command;
  const clearPrivate = useCallback(
    (status?: 401 | 403) => {
      generation.current++;
      editor.setValidationPending(false);
      networkOwner.current++;
      write.current?.abort();
      basis.current = null;
      commandRef.current = null;
      setCommand(null);
      editor.form.reset(windowValues(DEFAULT_DELIVERY_WINDOW));
      setStale(false);
      setUncertain(false);
      setRecoveryAttempt(null);
      setSaved(false);
      setSaving(false);
      setProtectedBusy(false);
      setError(null);
      if (status === 401) onSessionEnded?.();
    },
    [editor.form.reset, onSessionEnded]
  );
  const scope = useCatalogueScope(clearPrivate);
  const resource = useCatalogueResource(scope, '/api/admin/config/delivery-window', validWindow);
  const config = resource.data;
  const zones =
    config && !ALL_TIMEZONES.includes(config.timezone)
      ? [config.timezone, ...ALL_TIMEZONES]
      : ALL_TIMEZONES;
  const recovered =
    recoveryAttempt !== null &&
    resource.readAttempt !== null &&
    resource.readAttempt >= recoveryAttempt;
  const ready =
    !!config && !resource.loading && !resource.error && !scope.denied && !stale && !uncertain;
  const live = useRef({ ready, epoch: scope.version });
  live.current = { ready, epoch: scope.version };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      write.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!config) return;
    const next = windowBasis(config);
    if (basis.current !== next) {
      generation.current++;
      commandRef.current = null;
      setCommand(null);
      setProtectedBusy(false);
      if (basis.current !== null && editor.form.formState.isDirty) setStale(true);
      else if (!uncertain) editor.form.reset(windowValues(config));
      basis.current = next;
    }
  }, [config, editor.form.reset, editor.form.formState.isDirty, uncertain]);
  const current = (version: number, epoch: number) =>
    mounted.current &&
    generation.current === version &&
    scope.live.current === epoch &&
    getProfileContextRevision() === profileRevision;
  function markUnconfirmed() {
    setUncertain(true);
    setRecoveryAttempt(null);
  }
  function refresh() {
    if (protectedBusy) return;
    generation.current++;
    if (saving) markUnconfirmed();
    else editor.setValidationPending(false);
    commandRef.current = null;
    setCommand(null);
    setSaved(false);
    setError(null);
    const attempt = resource.retry();
    if (uncertain && !saving) setRecoveryAttempt(attempt);
  }
  function acceptSaved(result: unknown, expected: DeliveryWindowConfig) {
    if (
      !validWindow(result) ||
      windowBasis(result) !== windowBasis(expected) ||
      !resource.accept(result)
    ) {
      throw new Error(label('saveFailed'));
    }
    basis.current = windowBasis(result);
    editor.form.reset(windowValues(result));
    setStale(false);
    setUncertain(false);
    setRecoveryAttempt(null);
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
        const controller = new AbortController();
        write.current = controller;
        let unknown = true;
        setSaving(true);
        try {
          const { res, result } = await readWithDeadline(controller.signal, async (signal) => {
            const res = await fetch('/api/admin/config/delivery-window', {
              method: 'PUT',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(body),
              signal,
            });
            const result: unknown = await res.json().catch(() => null);
            return { res, result };
          });
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
                responseDeadline: true as const,
              },
              expected,
              generation: version,
            };
            commandRef.current = next;
            setCommand(next);
            return;
          }
          if (res.status === 401 || res.status === 403) {
            scope.deny(res.status);
            return;
          }
          if (res.status === 400 && Array.isArray(nested?.fields) && applyErrors(nested.fields))
            return;
          if (!res.ok) {
            unknown = res.status >= 500;
            throw new Error(label('saveFailed'));
          }
          acceptSaved(result, expected);
        } catch {
          if (current(version, epoch)) {
            setError(label('saveFailed'));
            if (unknown) markUnconfirmed();
          }
        } finally {
          if (write.current === controller) write.current = null;
          if (mounted.current && owner === networkOwner.current) {
            setSaving(false);
            editor.setValidationPending(false);
            if (generation.current !== version) markUnconfirmed();
          }
        }
      }
    } finally {
      if (generation.current === version) editor.setValidationPending(false);
    }
  }
  const feedback = (name: keyof WindowDraft) => (
    <CatalogueFieldFeedback
      compact
      id={editor.errorId(name)}
      error={editor.errors[name]}
      message={messages[name]}
    />
  );
  const busy = saving || editor.pending || !!command;
  const timezoneField = editor.bind('timezone');
  return (
    <section aria-labelledby="delivery-window-title" className="min-w-0 space-y-4">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Heading
            id="delivery-window-title"
            className={headingLevel === 1 ? 'text-2xl font-semibold' : 'text-lg font-semibold'}
          >
            {label('title')}
          </Heading>
          <p className="text-sm text-muted-foreground">{label('description')}</p>
        </div>
        <ListRefreshButton
          label={notificationFormText('refresh', uiLocale)}
          ref={refreshButton}
          disabled={resource.loading || protectedBusy}
          onClick={() => (scope.denied ? scope.recover() : refresh())}
        />
      </header>
      {resource.loading &&
        (config ? (
          <LoadingStatus>{label('loading')}</LoadingStatus>
        ) : (
          <SettingsValueSkeleton label={label('loading')} count={2} />
        ))}
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
            if (config && (!uncertain || recovered)) {
              generation.current++;
              editor.form.reset(windowValues(config));
              setStale(false);
              setUncertain(false);
              setRecoveryAttempt(null);
              setError(null);
            }
          }}
        >
          {notificationFormText('reset', uiLocale)}
        </Button>
      )}
      {!scope.denied && (
        <form
          onSubmit={submit}
          noValidate
          className={recordEditorSurface}
          aria-label={label('title')}
        >
          {error && (
            <Alert variant="destructive" className="m-4">
              {error}
            </Alert>
          )}
          {catalogueRootMessage(editor.errors) && (
            <Alert variant="destructive" className="m-4">
              {catalogueRootMessage(editor.errors)}
            </Alert>
          )}
          <fieldset disabled={!ready || busy} className="min-w-0">
            <legend className="sr-only">{label('title')}</legend>
            <RecordEditorSection title={notificationFormText('windowHours', uiLocale)}>
              <div className={recordEditorField}>
                <Label htmlFor="delivery-window-timezone">{label('timezone')}</Label>
                <ComboBox
                  items={zones}
                  value={editor.values.timezone}
                  openOnInputClick
                  autoHighlight
                  disabled={!ready || busy}
                  filter={(zone, query) => {
                    const search = timezoneSearchTerms(query);
                    const city = timezoneCityName(zone, 'fa');
                    return (
                      timezoneSearchTerms(zone).includes(search) ||
                      timezoneSearchTerms(city).includes(search)
                    );
                  }}
                  onValueChange={(zone) => {
                    if (!zone) return;
                    setSaved(false);
                    editor.field('timezone')[1](zone);
                  }}
                >
                  <div className="relative">
                    <SearchIcon
                      aria-hidden="true"
                      className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                    <ComboBoxInput
                      id="delivery-window-timezone"
                      ref={timezoneField.ref}
                      onBlur={timezoneField.onBlur}
                      placeholder={timezoneText('searchPlaceholder', uiLocale)}
                      className="h-11 ps-9"
                      aria-required="true"
                      aria-invalid={timezoneField['aria-invalid']}
                      aria-describedby={timezoneField['aria-describedby']}
                    />
                  </div>
                  <ComboBoxPopup
                    className="w-(--anchor-width) min-w-0 p-1"
                    dir={uiLocale === 'fa' ? 'rtl' : 'ltr'}
                    emptyMessage={tPreferenceSettingsForms('timezoneNoMatches', uiLocale)}
                  >
                    {(zone: string) => {
                      const city = timezoneCityName(zone, uiLocale);
                      return (
                        <ComboBoxItem key={zone} value={zone} className="min-h-10">
                          <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2">
                            <bdi className="break-all">{zone}</bdi>
                            {city && <bdi className="text-xs">{city}</bdi>}
                          </span>
                        </ComboBoxItem>
                      );
                    }}
                  </ComboBoxPopup>
                </ComboBox>
                {feedback('timezone')}
              </div>
              <div className={recordEditorGrid}>
                {(['startHour', 'endHour'] as const).map((name) => {
                  const field = editor.bind(name);
                  const boundary = name === 'startHour' ? 'start' : 'end';
                  const id = `delivery-window-${boundary}`;
                  return (
                    <div key={name} className={recordEditorField}>
                      <Label htmlFor={id}>{label(boundary)}</Label>
                      <RecordTimeInput
                        id={id}
                        locale={uiLocale}
                        className="min-h-11"
                        step="60"
                        {...field}
                        aria-required="true"
                        aria-describedby={
                          [
                            field['aria-describedby'],
                            uiLocale === 'fa' && 'delivery-window-clock-format',
                          ]
                            .filter(Boolean)
                            .join(' ') || undefined
                        }
                        value={editor.values[name]}
                        onChange={(time) => {
                          setSaved(false);
                          editor.field(name)[1](time);
                        }}
                      />
                      {feedback(name)}
                    </div>
                  );
                })}
              </div>
              {uiLocale === 'fa' && (
                <p id="delivery-window-clock-format" className="text-xs text-muted-foreground">
                  {accountTimeInputText('time24', uiLocale)}
                </p>
              )}
              {config && (
                <dl className="rounded-lg bg-muted/45 p-3 text-sm">
                  <dt className="text-muted-foreground">{label('current')}</dt>
                  <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-medium">
                    <bdi dir="ltr">
                      {formatWindowTime(config.startHour)}–{formatWindowTime(config.endHour)}
                    </bdi>
                    <bdi className="text-xs text-muted-foreground">{config.timezone}</bdi>
                  </dd>
                </dl>
              )}
            </RecordEditorSection>
          </fieldset>
          <RecordEditorActions>
            <CatalogueSaveButton
              pending={saving || editor.pending}
              disabled={!ready || busy}
              label={label(saving || editor.pending ? 'saving' : 'save')}
            />
            <CommandFeedback
              as="span"
              className="text-sm text-success"
              message={saved ? label('saved') : null}
            />
          </RecordEditorActions>
        </form>
      )}
      {command && (
        <TeamActionDialog
          action={command.action}
          finalFocus={() => refreshButton.current}
          confirmationDisabled={!ready || command.generation !== generation.current}
          onDenied={scope.deny}
          onValidationError={applyErrors}
          onPendingChange={setProtectedBusy}
          onUnconfirmed={() => {
            if (current(command.generation, scope.version)) markUnconfirmed();
          }}
          summary={
            <Button
              type="button"
              variant="outline"
              disabled={resource.loading || protectedBusy}
              onClick={refresh}
            >
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
