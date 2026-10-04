import { lazy, Suspense, useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { Alert, Button } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useSettingsSnapshot } from '../hooks/useSettingsSnapshot.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { withCsrf } from '../lib/csrf.js';
import {
  settingsErrorFields,
  verificationModes,
  validVerificationConfig,
  verificationBasis,
  invalidVerificationFields,
  type VerificationConfig,
  type VerificationDraft,
} from '../lib/verification-settings-form.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { OtpConfigPanel } from '../components/OtpConfigPanel.js';
const TeamActionDialog = lazy(() =>
  import('../components/TeamActionDialog.js').then((module) => ({
    default: module.TeamActionDialog,
  }))
);
export default function AdminVerificationConfig() {
  const locale = useLocale();
  const text = (key: Parameters<typeof verificationConfigText>[0]) =>
    verificationConfigText(key, locale);
  const form = useWizardForm<VerificationDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema({ mode: text('invalidMode') }, invalidVerificationFields);
    },
    () => ({ mode: 'MANUAL' }),
    text('formUnavailable')
  );
  const modeErrors = useActionFieldErrors(
    form.form,
    { mode: text('invalidMode') },
    text('invalid')
  );
  const resetForm = form.form.reset,
    register = form.form.register;
  const [focusEpoch, setFocusEpoch] = useState(0);
  const reset = useCallback(
    (value: VerificationConfig | null) => {
      resetForm({ mode: value?.draft ?? value?.mode ?? 'MANUAL' });
      setFocusEpoch((epoch) => epoch + 1);
      setSaved(false);
      setActivated(false);
      setSaveFailed(false);
    },
    [resetForm]
  );
  // Reset clears registered refs; reattach the composite focus target after each reset.
  const groupRef = useCallback(
    (node: HTMLFieldSetElement | null) => {
      register('mode').ref(
        node
          ? {
              focus: () =>
                (
                  node.querySelector<HTMLInputElement>('input:checked:not(:disabled)') ??
                  node.querySelector<HTMLInputElement>('input:not(:disabled)')
                )?.focus(),
            }
          : null
      );
    },
    [register, focusEpoch]
  );
  const [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false),
    [activated, setActivated] = useState(false),
    [saveFailed, setSaveFailed] = useState(false),
    [pending, setPending] = useState(false);
  const activateRef = useRef<HTMLButtonElement>(null),
    actionRef = useRef<TeamAction | null>(null),
    generation = useRef(0),
    validating = useRef(false),
    commandPending = useRef(false),
    directPending = useRef(false),
    directRequest = useRef<AbortController | null>(null);
  const onPendingChange = useCallback((value: boolean) => {
    commandPending.current = value;
    setPending(value);
  }, []);
  const withdraw = useCallback(() => {
    generation.current++;
    validating.current = false;
    directRequest.current?.abort();
    directPending.current = false;
    form.setValidationPending(false);
    actionRef.current = null;
    setAction(null);
    onPendingChange(false);
  }, [form.setValidationPending, onPendingChange]);
  const state = useSettingsSnapshot(
    '/api/admin/config/profile-verification-mode',
    validVerificationConfig,
    verificationBasis,
    reset,
    withdraw
  );
  useEffect(
    () => () => {
      generation.current++;
      actionRef.current = null;
      directRequest.current?.abort();
    },
    []
  );
  const current = state.current;
  const blocked = !state.ready || state.changed || state.uncertain;
  const busy = form.pending || !!action;
  function refresh() {
    if (commandPending.current || directPending.current) return;
    if (validating.current || state.uncertain) withdraw();
    setSaved(false);
    setActivated(false);
    setSaveFailed(false);
    state.refresh();
  }
  async function prepare(kind: 'draft' | 'activate', event?: FormEvent) {
    event?.preventDefault();
    if (blocked || !current || validating.current || actionRef.current || directPending.current)
      return;
    if (kind === 'draft' && form.values.mode === (current.draft ?? current.mode)) return;
    if (kind === 'activate' && (!current.draft || form.values.mode !== current.draft)) return;
    const epoch = generation.current;
    validating.current = true;
    form.setValidationPending(true);
    setSaved(false);
    setActivated(false);
    setSaveFailed(false);
    try {
      await form.form.handleSubmit(async (value) => {
        if (epoch !== generation.current || state.scope.denied) return;
        const body = { mode: value.mode, expectedVersion: current.version, action: kind };
        if (kind === 'activate') {
          const next: TeamAction = {
            title: text('activate'),
            description: `${text('warning')} ${text('draftMode')}: ${text(value.mode)}`,
            path: '/api/admin/config/profile-verification-mode',
            method: 'PUT',
            body,
            successStatus: 200,
            requiresPassword: true,
            conflictMessage: text('conflict'),
            forbiddenMessage: text('forbidden'),
          };
          actionRef.current = next;
          setAction(next);
          return;
        }
        directPending.current = true;
        const controller = new AbortController();
        directRequest.current = controller;
        try {
          const response = await fetch('/api/admin/config/profile-verification-mode', {
            method: 'PUT',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (controller.signal.aborted || epoch !== generation.current) return;
          if (response.status === 401 || response.status === 403) {
            state.scope.deny();
            return;
          }
          const raw: unknown = await response.json().catch(() => null);
          if (controller.signal.aborted || epoch !== generation.current) return;
          if (response.status === 400) {
            const fields = settingsErrorFields(raw);
            if (!fields.length || !modeErrors(fields)) setSaveFailed(true);
            return;
          }
          if (response.status === 409) {
            setSaveFailed(true);
            state.unconfirmed();
            return;
          }
          if (
            response.status !== 200 ||
            !validVerificationConfig(raw) ||
            raw.draft !== body.mode ||
            raw.mode !== current.mode ||
            raw.version !== body.expectedVersion + 1
          )
            throw new Error('Unconfirmed verification draft');
          if (!state.accept(raw)) return;
          setSaved(true);
          state.resource.retry();
        } catch {
          if (!controller.signal.aborted && epoch === generation.current) {
            setSaveFailed(true);
            state.unconfirmed();
          }
        } finally {
          if (epoch === generation.current) directPending.current = false;
        }
      })();
    } finally {
      if (epoch === generation.current) {
        validating.current = false;
        form.setValidationPending(false);
      }
    }
  }
  const completionGeneration = generation.current;
  return (
    <div
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      className="rounded-lg bg-background p-6 text-foreground space-y-5"
    >
      <h1 className="text-2xl font-bold">{text('title')}</h1>
      <p className="text-sm text-muted-foreground">{text('description')}</p>
      <p className="text-sm">{text('warning')}</p>
      {current && (
        <p className="text-sm">
          {text('activeMode')}: {text(current.mode)}
        </p>
      )}
      {state.scope.denied && <Alert variant="destructive">{text('forbidden')}</Alert>}
      {state.resource.loading && <p role="status">{text('loading')}</p>}
      {state.resource.error && (
        <Alert variant="destructive">
          {text('loadFailed')}{' '}
          <Button type="button" onClick={refresh}>
            {text('retry')}
          </Button>
        </Alert>
      )}
      {saveFailed && <Alert variant="destructive">{text('saveFailed')}</Alert>}
      {saved && <p role="status">{text('saved')}</p>}
      {activated && <p role="status">{text('activated')}</p>}
      {(state.changed || state.uncertain) && (
        <Alert variant="destructive">{text(state.uncertain ? 'unverified' : 'changedDraft')}</Alert>
      )}
      {(state.changed || state.uncertain) && (
        <Button
          type="button"
          variant="outline"
          disabled={busy || !state.ready || (state.uncertain && !state.recovered)}
          onClick={state.resetSaved}
        >
          {text('resetSaved')}
        </Button>
      )}
      <form
        noValidate
        aria-label={text('title')}
        aria-busy={form.pending || undefined}
        onSubmit={(event) => void prepare('draft', event)}
        className="max-w-xl space-y-4"
      >
        {catalogueRootMessage(form.errors) && (
          <Alert variant="destructive">{catalogueRootMessage(form.errors)}</Alert>
        )}
        <fieldset
          ref={groupRef}
          disabled={blocked || busy}
          className="min-w-0 space-y-4"
          aria-invalid={form.bind('mode')['aria-invalid']}
          aria-describedby={form.bind('mode')['aria-describedby']}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) form.bind('mode').onBlur();
          }}
        >
          <legend className="sr-only">{text('title')}</legend>
          {verificationModes.map((mode) => (
            <label
              key={mode}
              htmlFor={`verification-mode-${mode}`}
              className={`block p-4 border rounded-lg text-card-foreground transition-colors ${form.values.mode === mode ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  id={`verification-mode-${mode}`}
                  name="verification-mode"
                  value={mode}
                  disabled={mode === 'API'}
                  checked={state.hydrated && !!current && form.values.mode === mode}
                  aria-describedby={[
                    `verification-mode-${mode}-description`,
                    form.bind('mode')['aria-describedby'],
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onChange={() => {
                    form.field('mode')[1](mode);
                    setSaveFailed(false);
                    setSaved(false);
                    setActivated(false);
                  }}
                  className="accent-primary focus-visible:outline-2 focus-visible:outline-ring"
                />
                <span>
                  <span className="block font-medium text-sm">{text(mode)}</span>
                  <span
                    id={`verification-mode-${mode}-description`}
                    className="block text-xs text-foreground/80 mt-0.5"
                  >
                    {text(`${mode}_description`)}
                  </span>
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <CatalogueFieldFeedback
          id={form.errorId('mode')}
          error={form.errors.mode}
          message={text('invalidMode')}
        />
        <CatalogueSaveButton
          label={text('save')}
          pending={form.pending}
          disabled={blocked || busy || form.values.mode === (current?.draft ?? current?.mode)}
        />
      </form>
      {current?.draft && (
        <div className="max-w-xl space-y-3 border-t border-border pt-4">
          <p>
            {text('draftMode')}: {text(current.draft)}
          </p>
          <Button
            ref={activateRef}
            type="button"
            disabled={
              blocked || busy || form.values.mode !== current.draft || current.draft === 'API'
            }
            onClick={() => void prepare('activate')}
          >
            {text('activate')}
          </Button>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={state.resource.loading || pending || (form.pending && directPending.current)}
        onClick={refresh}
      >
        {text('reload')}
      </Button>
      {action && (
        <Suspense fallback={<p role="status">{text('loading')}</p>}>
          <TeamActionDialog
            action={action}
            finalFocus={activateRef}
            onClose={withdraw}
            onDenied={state.scope.deny}
            onPendingChange={onPendingChange}
            onUnconfirmed={state.unconfirmed}
            onValidationError={modeErrors}
            confirmationDisabled={blocked}
            summary={
              <Button
                type="button"
                variant="outline"
                disabled={state.resource.loading || pending}
                onClick={refresh}
              >
                {text('reload')}
              </Button>
            }
            onSuccess={async (raw) => {
              if (
                completionGeneration !== generation.current ||
                actionRef.current !== action ||
                state.scope.denied
              )
                return;
              const body = action.body as {
                mode: VerificationDraft['mode'];
                expectedVersion: number;
              };
              if (
                !validVerificationConfig(raw) ||
                raw.mode !== body.mode ||
                raw.draft !== null ||
                raw.version !== body.expectedVersion + 1
              )
                throw new Error('Unconfirmed verification activation');
              if (!state.accept(raw)) throw new Error('Obsolete verification receipt');
              withdraw();
              setActivated(true);
              state.resource.retry();
            }}
          />
        </Suspense>
      )}
      <OtpConfigPanel />
    </div>
  );
}
