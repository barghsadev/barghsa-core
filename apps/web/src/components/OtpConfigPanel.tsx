import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { TeamAction } from './TeamActionDialog.js';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useSettingsSnapshot } from '../hooks/useSettingsSnapshot.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  validOtpConfig,
  otpBasis,
  invalidOtpFields,
  type OtpConfig,
  type OtpDraft,
} from '../lib/verification-settings-form.js';
import { Alert, Button, Input, Label } from '@barghsa/ui';
import { CatalogueFieldFeedback, catalogueRootMessage } from './CatalogueEditorFeedback.js';
import { SettingsFormSection } from './SettingsFormSection.js';
import { AuditLogViewer } from './AuditLogViewer.js';
const TeamActionDialog = lazy(() =>
  import('./TeamActionDialog.js').then((module) => ({ default: module.TeamActionDialog }))
);
export function OtpConfigPanel() {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const text = (key: Parameters<typeof verificationConfigText>[0]) =>
    verificationConfigText(key, locale);
  const form = useWizardForm<OtpDraft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema({ ttlSeconds: text('invalidLifetime') }, invalidOtpFields);
    },
    () => ({ ttlSeconds: '' }),
    text('formUnavailable')
  );
  const fieldErrors = useActionFieldErrors(
    form.form,
    { ttlSeconds: text('invalidLifetime') },
    text('invalid')
  );
  const resetForm = form.form.reset;
  const reset = useCallback(
    (value: OtpConfig | null) => {
      resetForm({ ttlSeconds: value ? String(value.ttlSeconds) : '' });
      setSaved(false);
    },
    [resetForm]
  );
  const [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false),
    [pending, setPending] = useState(false);
  const saveRef = useRef<HTMLButtonElement>(null),
    actionRef = useRef<TeamAction | null>(null),
    generation = useRef(0),
    validating = useRef(false),
    commandPending = useRef(false);
  const onPendingChange = useCallback((value: boolean) => {
    commandPending.current = value;
    setPending(value);
  }, []);
  const withdraw = useCallback(() => {
    generation.current++;
    validating.current = false;
    form.setValidationPending(false);
    actionRef.current = null;
    setAction(null);
    onPendingChange(false);
  }, [form.setValidationPending, onPendingChange]);
  const state = useSettingsSnapshot(
    '/api/admin/config/otp',
    validOtpConfig,
    otpBasis,
    reset,
    withdraw
  );
  useEffect(
    () => () => {
      generation.current++;
      actionRef.current = null;
    },
    []
  );
  const blocked = !state.ready || state.changed || state.uncertain;
  const busy = form.pending || !!action;
  function refresh() {
    if (commandPending.current) return;
    if (validating.current || state.uncertain) withdraw();
    setSaved(false);
    state.refresh();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked || !state.current || validating.current || actionRef.current) return;
    const epoch = generation.current;
    validating.current = true;
    form.setValidationPending(true);
    setSaved(false);
    try {
      let body: { ttlSeconds: number; expectedVersion: number } | undefined;
      await form.form.handleSubmit((value) => {
        const ttlSeconds = Number(value.ttlSeconds);
        if (ttlSeconds !== state.current!.ttlSeconds)
          body = { ttlSeconds, expectedVersion: state.current!.version };
      })();
      if (!body || epoch !== generation.current || state.scope.denied) return;
      const next: TeamAction = {
        title: text('otpSave'),
        description: text('otpDescription'),
        path: '/api/admin/config/otp',
        method: 'PUT',
        body,
        successStatus: 200,
        requiresPassword: true,
        conflictMessage: text('otpConflict'),
        forbiddenMessage: text('forbidden'),
      };
      actionRef.current = next;
      setAction(next);
    } finally {
      if (epoch === generation.current) {
        validating.current = false;
        form.setValidationPending(false);
      }
    }
  }
  const completionGeneration = generation.current;
  const feedback = (
    <>
      {state.scope.denied && <Alert variant="destructive">{text('forbidden')}</Alert>}
      {state.resource.loading && <p role="status">{text('otpLoading')}</p>}
      {state.resource.error && <Alert variant="destructive">{text('otpLoadFailed')}</Alert>}
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
      {catalogueRootMessage(form.errors) && (
        <Alert variant="destructive">{catalogueRootMessage(form.errors)}</Alert>
      )}
    </>
  );
  return (
    <>
      <SettingsFormSection
        title={text('otpTitle')}
        headingId="otp-config-title"
        description={text('otpDescription')}
        className="mt-8 max-w-xl"
        saved={saved}
        savedMessage={text('otpSaved')}
        noValidate
        aria-busy={form.pending || undefined}
        onSubmit={(event) => void submit(event)}
        actions={
          <>
            <Button
              ref={saveRef}
              type="submit"
              disabled={
                blocked || busy || Number(form.values.ttlSeconds) === state.current?.ttlSeconds
              }
              aria-busy={form.pending || undefined}
            >
              {form.pending && (
                <span
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {text('otpSave')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={state.resource.loading || pending}
              onClick={refresh}
            >
              {text('otpReload')}
            </Button>
          </>
        }
      >
        {feedback}
        {saved && <p role="status">{text('otpSaved')}</p>}
        <fieldset disabled={blocked || busy} className="space-y-2 min-w-0">
          <legend className="sr-only">{text('otpTitle')}</legend>
          <Label htmlFor="otp-lifetime">{text('otpLabel')}</Label>
          <Input
            {...form.bind('ttlSeconds')}
            id="otp-lifetime"
            type="number"
            min={60}
            max={900}
            step={1}
            required
            value={form.values.ttlSeconds}
            aria-describedby={[form.bind('ttlSeconds')['aria-describedby'], 'otp-lifetime-hint']
              .filter(Boolean)
              .join(' ')}
            onChange={(event) => {
              form.field('ttlSeconds')[1](event.target.value);
              setSaved(false);
            }}
          />
          <p id="otp-lifetime-hint" className="text-sm text-muted-foreground">
            {text('otpRange')
              .replace('{min}', numbers.number(60))
              .replace('{max}', numbers.number(900))}
          </p>
          <CatalogueFieldFeedback
            id={form.errorId('ttlSeconds')}
            error={form.errors.ttlSeconds}
            message={text('invalidLifetime')}
          />
        </fieldset>
      </SettingsFormSection>
      {state.current && (
        <AuditLogViewer
          scope="otp"
          refreshKey={state.current.version}
          onDenied={state.scope.deny}
        />
      )}
      {action && (
        <Suspense fallback={<p role="status">{text('loading')}</p>}>
          <TeamActionDialog
            finalFocus={saveRef}
            action={action}
            onClose={withdraw}
            onDenied={state.scope.deny}
            onPendingChange={onPendingChange}
            onUnconfirmed={state.unconfirmed}
            onValidationError={fieldErrors}
            confirmationDisabled={blocked}
            summary={
              <Button
                type="button"
                variant="outline"
                disabled={state.resource.loading || pending}
                onClick={refresh}
              >
                {text('otpReload')}
              </Button>
            }
            onSuccess={async (raw) => {
              if (
                completionGeneration !== generation.current ||
                actionRef.current !== action ||
                state.scope.denied
              )
                return;
              const body = action.body as { ttlSeconds: number; expectedVersion: number };
              if (
                !validOtpConfig(raw) ||
                raw.ttlSeconds !== body.ttlSeconds ||
                raw.version !== body.expectedVersion + 1
              )
                throw new Error('Unconfirmed OTP configuration');
              if (!state.accept(raw)) throw new Error('Obsolete OTP receipt');
              withdraw();
              setSaved(true);
              state.resource.retry();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
