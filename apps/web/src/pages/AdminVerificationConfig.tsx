import { CommandFeedback } from '../components/CommandFeedback.js';
import { lazy, Suspense, useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { LoadingStatus, Alert, Button } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useSettingsSnapshot } from '../hooks/useSettingsSnapshot.js';
import { useCatalogueResource } from '../hooks/useCatalogueResource.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { CONFIG_AUDIT_ID } from '@barghsa/shared/admin';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { withCsrf } from '../lib/csrf.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import {
  settingsErrorFields,
  verificationModes,
  validVerificationConfig,
  verificationBasis,
  invalidVerificationFields,
  type VerificationConfig,
  type VerificationDraft,
  type VerificationMode,
} from '../lib/verification-settings-form.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from '../components/CatalogueEditorFeedback.js';
import { OtpConfigPanel } from '../components/OtpConfigPanel.js';
import { VerificationPolicySettings } from '../components/VerificationPolicySettings.js';
const SecurityRateLimitPanel = lazy(() => import('../components/SecurityRateLimitPanel.js'));
const TeamActionDialog = lazy(() =>
  import('../components/TeamActionDialog.js').then((module) => ({
    default: module.TeamActionDialog,
  }))
);
const modePath = '/api/admin/config/profile-verification-mode';
type ModeRevision = { id: string; version: number; value: VerificationMode };
type ModeHistory = { items: ModeRevision[]; nextBeforeVersion: number | null };
type ModeAction = TeamAction & {
  mode: VerificationMode;
  body: { expectedVersion: number } & (
    { action: 'activate'; mode: VerificationMode } | { action: 'restore'; sourceId: string }
  );
};
const historyVersion = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
function validModeHistory(value: unknown): value is ModeHistory {
  if (!value || typeof value !== 'object') return false;
  const { items, nextBeforeVersion } = value as Partial<ModeHistory>;
  return (
    Array.isArray(items) &&
    items.length <= 20 &&
    items.every(
      (row: ModeRevision) =>
        row &&
        typeof row.id === 'string' &&
        CONFIG_AUDIT_ID.test(row.id) &&
        historyVersion(row.version) &&
        verificationModes.includes(row.value)
    ) &&
    (nextBeforeVersion === null || historyVersion(nextBeforeVersion))
  );
}
export default function AdminVerificationConfig() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedVerificationSettings key={JSON.stringify([actor, revision])} />;
}
function OwnedVerificationSettings() {
  const locale = useLocale();
  const [denied, setDenied] = useState(false);
  const denyRead = useCallback(() => setDenied(true), []);
  return (
    <div
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      className="rounded-lg bg-background p-6 text-foreground space-y-5"
    >
      <h1 className="text-2xl font-bold">{verificationConfigText('title', locale)}</h1>
      {denied ? (
        <Alert variant="destructive">
          {verificationConfigText('forbidden', locale)}{' '}
          <Button type="button" onClick={() => setDenied(false)}>
            {verificationConfigText('reload', locale)}
          </Button>
        </Alert>
      ) : (
        <VerificationSettings onReadDenied={denyRead} />
      )}
    </div>
  );
}
function VerificationSettings({ onReadDenied }: { onReadDenied: () => void }) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [rateLimitsOpened, setRateLimitsOpened] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [beforeVersion, setBeforeVersion] = useState<number | null>(null);
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
  const [action, setAction] = useState<ModeAction | null>(null),
    [saved, setSaved] = useState(false),
    [activated, setActivated] = useState(false),
    [saveFailed, setSaveFailed] = useState(false),
    [pending, setPending] = useState(false);
  const activateRef = useRef<HTMLButtonElement>(null),
    actionRef = useRef<ModeAction | null>(null),
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
    modePath,
    validVerificationConfig,
    verificationBasis,
    reset,
    withdraw,
    onReadDenied
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
  const history = useCatalogueResource(
    { ...state.scope, deny: onReadDenied },
    showHistory
      ? modePath + '/history' + (beforeVersion === null ? '' : '?beforeVersion=' + beforeVersion)
      : null,
    validModeHistory
  );
  const olderPage = history.data?.nextBeforeVersion ?? null;
  function restore(revision: ModeRevision) {
    if (
      blocked ||
      busy ||
      !current ||
      revision.value === 'API' ||
      revision.version > current.version
    )
      return;
    const next: ModeAction = {
      path: modePath,
      method: 'PUT',
      mode: revision.value,
      title: text('policyRestore'),
      description: text('policyRestoreReview'),
      body: { action: 'restore', expectedVersion: current.version, sourceId: revision.id },
      conflictMessage: text('conflict'),
      forbiddenMessage: text('forbidden'),
    };
    actionRef.current = next;
    setAction(next);
    setSaved(false);
    setActivated(false);
    setSaveFailed(false);
  }
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
          const next: ModeAction = {
            ...(value.mode === 'DISABLED' ? { risk: 'destructive' as const } : {}),
            title: text('activate'),
            description: `${text('warning')} ${text('draftMode')}: ${text(value.mode)}`,
            path: modePath,
            method: 'PUT',
            mode: value.mode,
            body: { ...body, action: 'activate' },
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
          const { status, raw } = await readWithDeadline(controller.signal, async (signal) => {
            const response = await fetch(modePath, {
              method: 'PUT',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(body),
              signal,
            });
            const raw: unknown =
              response.status === 401 || response.status === 403
                ? null
                : await response.json().catch(() => null);
            return { status: response.status, raw };
          });
          if (controller.signal.aborted || epoch !== generation.current) return;
          if (status === 401 || status === 403) {
            state.denyCommand(status);
            return;
          }
          if (status === 400) {
            const fields = settingsErrorFields(raw);
            if (!fields.length || !modeErrors(fields)) setSaveFailed(true);
            return;
          }
          if (status === 409) {
            setSaveFailed(true);
            state.unconfirmed();
            return;
          }
          if (
            status !== 200 ||
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
    <>
      <p className="text-sm text-muted-foreground">{text('description')}</p>
      <p className="text-sm">{text('warning')}</p>
      {current && (
        <p className="text-sm">
          {text('activeMode')}: {text(current.mode)}
        </p>
      )}
      {state.scope.denied && <Alert variant="destructive">{text('forbidden')}</Alert>}
      {state.resource.loading && <LoadingStatus>{text('loading')}</LoadingStatus>}
      {state.resource.error && (
        <Alert variant="destructive">
          {text('loadFailed')}{' '}
          <Button type="button" onClick={refresh}>
            {text('retry')}
          </Button>
        </Alert>
      )}
      {saveFailed && <Alert variant="destructive">{text('saveFailed')}</Alert>}
      <CommandFeedback message={saved ? text('saved') : null} />
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
      {current && (
        <Button
          type="button"
          variant="outline"
          aria-expanded={showHistory}
          disabled={busy}
          onClick={() => {
            setShowHistory(!showHistory);
            setBeforeVersion(null);
          }}
        >
          {text('modeHistory')}
        </Button>
      )}
      {showHistory && current && (
        <section aria-label={text('modeHistory')} className="max-w-xl space-y-3 border-t pt-4">
          {history.loading && <LoadingStatus>{text('loading')}</LoadingStatus>}
          {history.error && (
            <Alert variant="destructive">
              {text('loadFailed')}{' '}
              <Button type="button" onClick={history.retry}>
                {text('retry')}
              </Button>
            </Alert>
          )}
          {!history.loading && !history.error && history.data && (
            <>
              {history.data.items.length === 0 ? (
                <p>{text('policyHistoryEmpty')}</p>
              ) : (
                <ul className="divide-y">
                  {history.data.items.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2"
                    >
                      <span>
                        {text('rateRecoveryVersion').replace(
                          '{version}',
                          numbers.number(entry.version, { useGrouping: false })
                        )}{' '}
                        · {text(entry.value)}
                      </span>
                      {entry.value !== 'API' && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={blocked || busy || entry.version > current.version}
                          onClick={() => restore(entry)}
                        >
                          {text('policyRestore')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {beforeVersion !== null && (
                <Button type="button" variant="ghost" onClick={() => setBeforeVersion(null)}>
                  {text('rateRecoveryLatest')}
                </Button>
              )}
              {olderPage !== null && (
                <Button type="button" variant="ghost" onClick={() => setBeforeVersion(olderPage)}>
                  {text('rateRecoveryOlder')}
                </Button>
              )}
            </>
          )}
        </section>
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
            finalFocus={action.body.action === 'activate' ? activateRef : undefined}
            onClose={withdraw}
            onDenied={state.denyCommand}
            onPendingChange={onPendingChange}
            onUnconfirmed={state.unconfirmed}
            onValidationError={modeErrors}
            confirmationDisabled={blocked}
            summary={
              action.body.action === 'restore' ? (
                <p>{text(action.mode)}</p>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={state.resource.loading || pending}
                  onClick={refresh}
                >
                  {text('reload')}
                </Button>
              )
            }
            onSuccess={async (raw) => {
              if (
                completionGeneration !== generation.current ||
                actionRef.current !== action ||
                state.scope.denied
              )
                return;
              const { body, mode } = action;
              const activating = body.action === 'activate';
              if (
                !validVerificationConfig(raw) ||
                raw.mode !== (activating ? mode : current?.mode) ||
                raw.draft !== (activating ? null : mode) ||
                raw.version !== body.expectedVersion + 1
              )
                throw new Error('Unconfirmed verification activation');
              if (!state.accept(raw)) throw new Error('Obsolete verification receipt');
              withdraw();
              setActivated(activating);
              setSaved(!activating);
              state.resource.retry();
              if (activating && showHistory) history.retry();
            }}
          />
        </Suspense>
      )}
      <OtpConfigPanel onReadDenied={onReadDenied} />
      <VerificationPolicySettings onReadDenied={onReadDenied} />
      <details
        className="max-w-xl rounded border p-3"
        onToggle={(event) => {
          if (event.currentTarget.open) setRateLimitsOpened(true);
        }}
      >
        <summary className="min-h-11 cursor-pointer content-center font-medium">
          {text('rateLimitTitle')}
        </summary>
        {rateLimitsOpened && (
          <Suspense fallback={<LoadingStatus>{text('loading')}</LoadingStatus>}>
            <SecurityRateLimitPanel onReadDenied={onReadDenied} />
          </Suspense>
        )}
      </details>
    </>
  );
}
