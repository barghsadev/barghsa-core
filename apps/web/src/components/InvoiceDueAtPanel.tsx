import { CommandFeedback } from './CommandFeedback.js';
import { useOwnedStaffServiceRead } from '../hooks/useOwnedStaffServiceRead.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { sendToast } from '../lib/toast-api.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label, ListRefreshButton, Textarea } from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { t as appText } from '@barghsa/i18n/workspace';
import type { InvoiceDueAtOverrideSnapshot } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { SettingsValueSkeleton } from './CatalogueEditorFeedback.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useInvoiceLookupForm } from '../hooks/useInvoiceLookupForm.js';
import { useDeadlineForm } from '../hooks/useDeadlineForms.js';
import { withCsrf } from '../lib/csrf.js';
import { authErrorCode } from '../lib/auth-errors.js';
import {
  changedDeadline,
  deadlineInstant,
  isoToDatetimeLocal,
  lookupMatchesLoadedInvoice,
} from '../lib/due-at-override.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { RecordDateTimeField } from './RecordDateTimeField.js';
import {
  RefundFieldFeedback as FieldFeedback,
  RefundFormAlert as FormAlert,
} from './RefundFormFeedback.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from './RecordEditorLayout.js';

interface InvoiceDueAtDto {
  invoiceId: string;
  state: string;
  issuedAt: string | null;
  payableFrom: string | null;
  dueAt: string | null;
  canOverride: boolean;
  dueAtOverride: InvoiceDueAtOverrideSnapshot | null;
  auditId?: string;
}

function isInvoiceResponse(value: unknown, expectedId: string): value is InvoiceDueAtDto {
  if (!value || typeof value !== 'object') return false;
  const row = value as InvoiceDueAtDto;
  const instant = (item: unknown) =>
    item === null || (typeof item === 'string' && Number.isFinite(Date.parse(item)));
  return (
    typeof row.invoiceId === 'string' &&
    lookupMatchesLoadedInvoice(expectedId, row.invoiceId) &&
    typeof row.state === 'string' &&
    typeof row.canOverride === 'boolean' &&
    instant(row.issuedAt) &&
    instant(row.payableFrom) &&
    instant(row.dueAt) &&
    (row.dueAtOverride === null ||
      Boolean(row.dueAtOverride && typeof row.dueAtOverride.reason === 'string'))
  );
}

function basis(row: InvoiceDueAtDto | null) {
  return (
    row &&
    JSON.stringify([
      row.invoiceId,
      row.state,
      row.issuedAt,
      row.payableFrom,
      row.dueAt,
      row.canOverride,
      row.dueAtOverride,
    ])
  );
}
interface Command {
  invoiceId: string;
  dueAt: string;
  reason: string;
  timezone: string;
  owner: number;
}
export default function InvoiceDueAtPanel(props: Parameters<typeof OwnedInvoiceDueAtPanel>[0]) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedInvoiceDueAtPanel key={JSON.stringify([actor, revision, props.recordId])} {...props} />
  );
}
function OwnedInvoiceDueAtPanel({
  selection,
  recordId,
  onLocked,
}: {
  selection?: { invoiceId: string; revision: number } | null;
  recordId?: string;
  onLocked?: (locked: boolean) => void;
}) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const readStaff = useOwnedStaffServiceRead(actor, profileRevision);
  const locale = useLocale(),
    time = useAccountTime();
  const [dueTimezone, setDueTimezone] = useState('');
  const [invoice, setInvoice] = useState<InvoiceDueAtDto | null>(null);
  const lookup = useInvoiceLookupForm(t('admin.invoices.error.invoiceId', locale), recordId);
  const [invoiceId, setInvoiceId] = lookup.field('invoiceId');
  const draft = useDeadlineForm({
    dueAt: invoice?.dueAt ?? null,
    issuedAt: invoice?.issuedAt ?? null,
    timezone: dueTimezone,
  });
  const [dueLocal, setDueLocal] = draft.field('dueAt'),
    [reason, setReason] = draft.field('reason');
  const [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  const [unavailable, setUnavailable] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<(TeamAction & Command) | null>(null);
  const generation = useRef(0),
    loadVersion = useRef(0),
    inFlight = useRef(false),
    live = useRef(false);
  const readAbort = useRef<AbortController | null>(null);
  const writeAbort = useRef<AbortController | null>(null);
  const invalidFocus = useRef<'dueAt' | 'reason' | null>(null);
  useEffect(() => {
    if (!saving && invalidFocus.current) {
      draft.form.setFocus(invalidFocus.current);
      invalidFocus.current = null;
    }
  }, [saving, draft.form]);
  const submitButton = useRef<HTMLButtonElement>(null);
  const canEditTime = time.status === 'ready' && dueTimezone === time.timezone;
  const proposedDue =
    canEditTime && invoice && !unavailable
      ? changedDeadline(dueLocal, {
          dueAt: invoice.dueAt,
          issuedAt: invoice.issuedAt,
          timezone: dueTimezone,
        })
      : null;
  const locked = saving || Boolean(pendingAction),
    readLocked = locked || (lookup.form.formState.isSubmitting && !loading);
  useEffect(() => {
    onLocked?.(locked);
    return () => onLocked?.(false);
  }, [locked, onLocked]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      readAbort.current?.abort();
      writeAbort.current?.abort();
      generation.current++;
      loadVersion.current++;
    };
  }, []);
  function clearWork() {
    readAbort.current?.abort();
    writeAbort.current?.abort();
    invalidFocus.current = null;
    generation.current++;
    loadVersion.current++;
    setInvoice(null);
    draft.form.reset({ dueAt: '', reason: '' });
    setSaved(false);
    setPendingAction(null);
    setUnavailable(true);
    setLoading(false);
    setSaving(false);
    inFlight.current = false;
  }
  useEffect(() => {
    if (!selection) return;
    clearWork();
    lookup.form.reset({ invoiceId: selection.invoiceId });
    setError(null);
    // An explicit ledger selection starts a new private draft scope.
  }, [selection]);
  useEffect(() => {
    if (time.status === 'ready' && dueTimezone && dueTimezone !== time.timezone) {
      writeAbort.current?.abort();
      generation.current++;
      loadVersion.current++;
      inFlight.current = false;
      setSaving(false);
      setLoading(false);
      setPendingAction(null);
      setUnavailable(true);
    }
  }, [time.status, time.timezone, dueTimezone]);
  const current = (owner: number) =>
    live.current && owner === generation.current && getProfileContextRevision() === profileRevision;
  function unconfirmed(owner: number) {
    if (!current(owner)) return;
    setUnavailable(true);
    setError(confirmationText('unconfirmed', locale));
  }
  function handleInvoiceIdChange(next: string) {
    if (inFlight.current || pendingAction || (lookup.form.isSubmissionPending() && !loading))
      return;
    readAbort.current?.abort();
    loadVersion.current++;
    setLoading(false);
    setInvoiceId(next);
    setError(null);
    if (invoice && !lookupMatchesLoadedInvoice(next, invoice.invoiceId)) clearWork();
  }
  async function loadInvoice(event?: FormEvent) {
    event?.preventDefault();
    if (
      time.status !== 'ready' ||
      inFlight.current ||
      pendingAction ||
      lookup.form.isSubmissionPending()
    )
      return;
    const owner = generation.current,
      zone = time.timezone;
    await lookup.form.handleSubmit(async ({ invoiceId }) => {
      if (!current(owner)) return;
      const id = invoiceId.trim(),
        version = ++loadVersion.current;
      readAbort.current?.abort();
      const controller = new AbortController();
      readAbort.current = controller;
      setLoading(true);
      setUnavailable(true);
      setError(null);
      setSaved(false);
      try {
        const response = await readStaff(
          'invoices',
          'detail',
          `/api/admin/invoices/${id}/due-at`,
          controller.signal
        );
        if (!current(owner) || version !== loadVersion.current) return;
        if (response.status === 401 || response.status === 403) {
          clearWork();
          setError(t('admin.invoices.denied', locale));
          return;
        }
        if (!response.ok) throw new Error('read');
        const data: unknown = await response.json();
        if (!current(owner) || version !== loadVersion.current) return;
        if (!isInvoiceResponse(data, id)) throw new Error('read');
        if (basis(invoice) !== basis(data) || zone !== dueTimezone) {
          generation.current++;
          draft.form.reset({
            dueAt: isoToDatetimeLocal(data.dueAt, zone),
            reason: data.dueAtOverride?.reason ?? '',
          });
        }
        setInvoice(data);
        setDueTimezone(zone);
        setUnavailable(false);
      } catch {
        if (current(owner) && version === loadVersion.current)
          setError(t('admin.invoices.error.load', locale));
      } finally {
        if (version === loadVersion.current && live.current) setLoading(false);
      }
    })(event);
  }
  useEffect(() => {
    if (!recordId || time.status !== 'ready' || dueTimezone) return;
    const start = window.setTimeout(() => void loadInvoice(), 0);
    return () => window.clearTimeout(start);
  }, [recordId, time.status, time.timezone, dueTimezone]);
  function accepted(data: unknown, command: Command) {
    if (!current(command.owner)) return;
    if (
      !isInvoiceResponse(data, command.invoiceId) ||
      data.dueAt !== command.dueAt ||
      data.dueAtOverride?.reason !== command.reason
    )
      throw new Error('receipt');
    setInvoice(data);
    setDueTimezone(command.timezone);
    draft.form.reset({
      dueAt: isoToDatetimeLocal(data.dueAt, command.timezone),
      reason: command.reason,
    });
    setSaved(true);
    setError(null);
  }
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (
      inFlight.current ||
      pendingAction ||
      loading ||
      unavailable ||
      !invoice?.canOverride ||
      !canEditTime ||
      !lookupMatchesLoadedInvoice(invoiceId, invoice.invoiceId)
    )
      return;
    const owner = generation.current,
      source = invoice,
      timezone = dueTimezone;
    inFlight.current = true;
    setSaving(true);
    setSaved(false);
    setError(null);
    let controller: AbortController | undefined;
    try {
      await draft.form.handleSubmit(
        async (values) => {
          if (!current(owner)) return;
          const dueAt = deadlineInstant(values.dueAt, { dueAt: source.dueAt, timezone });
          if (!dueAt) return;
          const command: Command = {
            invoiceId: source.invoiceId,
            dueAt,
            reason: values.reason.trim(),
            timezone,
            owner,
          };
          const path = `/api/admin/invoices/${command.invoiceId}/due-at`,
            body = { dueAt, reason: command.reason };
          controller = new AbortController();
          writeAbort.current = controller;
          const { response, data } = await readWithDeadline(controller.signal, async (signal) => {
            const response = await fetch(path, {
              method: 'POST',
              credentials: 'include',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(body),
              signal,
            });
            const data: unknown = await response.json().catch(() => null);
            return { response, data };
          });
          if (!current(owner)) return;
          if (
            response.status === 403 &&
            authErrorCode(data) === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
          ) {
            setPendingAction({
              ...command,
              path,
              method: 'POST',
              body,
              requiresPassword: true,
              responseDeadline: true,
              title: t('admin.invoices.stepUp.title', locale),
              description: t('admin.invoices.stepUp.description', locale),
            });
            return;
          }
          if (response.status === 401 || response.status === 403) {
            clearWork();
            setError(t('admin.invoices.denied', locale));
            return;
          }
          if (!response.ok) {
            const fields = (data as { error?: { fields?: unknown[] } } | null)?.error?.fields;
            if (
              response.status === 400 &&
              authErrorCode(data) === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
              Array.isArray(fields) &&
              draft.applyServerErrors(fields)
            )
              return;
            if (response.status >= 500) throw new Error('unconfirmed');
            setError(t('admin.invoices.error.save', locale));
            return;
          }
          accepted(data, command);
        },
        (errors) => {
          if (current(owner))
            invalidFocus.current =
              (['dueAt', 'reason'] as const).find((name) => errors[name]) ?? null;
        }
      )(event);
    } catch {
      if (current(owner)) {
        if (controller) {
          unconfirmed(owner);
          sendToast('warning', confirmationText('unconfirmed', locale));
        } else setError(t('admin.invoices.error.save', locale));
      }
    } finally {
      if (writeAbort.current === controller) writeAbort.current = null;
      if (current(owner)) {
        inFlight.current = false;
        setSaving(false);
      }
    }
  }
  return (
    <>
      {time.notice}
      {pendingAction && (
        <TeamActionDialog
          action={pendingAction}
          finalFocus={submitButton}
          confirmationDisabled={!canEditTime || unavailable || !current(pendingAction.owner)}
          onUnconfirmed={() => unconfirmed(pendingAction.owner)}
          onClose={() => setPendingAction(null)}
          onSuccess={async (data) => accepted(data, pendingAction)}
          onDenied={() => {
            clearWork();
            setError(t('admin.invoices.denied', locale));
          }}
          onValidationError={(fields) =>
            current(pendingAction.owner) && draft.applyServerErrors(fields)
          }
        />
      )}
      <div
        id="invoice-deadline-panel"
        className="max-w-3xl space-y-4"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            {!recordId && (
              <h2 className="text-2xl font-bold">{t('admin.invoices.title', locale)}</h2>
            )}
            <p className="text-sm text-muted-foreground">
              {t('admin.invoices.description', locale)}
            </p>
          </div>
          {recordId && time.status === 'ready' && (
            <ListRefreshButton
              label={t('admin.invoices.load', locale)}
              disabled={readLocked || loading}
              onClick={() => void loadInvoice()}
            />
          )}
        </header>
        <FormAlert message={error ?? undefined} />
        {recordId ? (
          lookup.errors.root?.validation ? (
            <FormAlert message={lookup.errors.root.validation.message} />
          ) : loading || (time.status === 'ready' && !invoice && !error) ? (
            <SettingsValueSkeleton label={t('admin.invoices.loading', locale)} count={2} />
          ) : null
        ) : (
          <form
            onSubmit={loadInvoice}
            noValidate
            className="bg-card text-card-foreground rounded-lg border border-border p-6 space-y-3"
          >
            <div className={recordEditorField}>
              <Label htmlFor="invoice-id">{t('admin.invoices.invoiceId', locale)}</Label>
              <Input
                id="invoice-id"
                {...lookup.bind('invoiceId')}
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                required
                aria-required="true"
                disabled={readLocked}
                value={invoiceId}
                onChange={(e) => handleInvoiceIdChange(e.target.value)}
                aria-describedby={[
                  'invoice-id-hint',
                  lookup.errors.invoiceId ? lookup.errorId('invoiceId') : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
                className="font-mono"
                dir="ltr"
              />
              <p id="invoice-id-hint" className="text-xs text-muted-foreground mt-1">
                {t('admin.invoices.invoiceIdHint', locale)}
              </p>
            </div>
            <FieldFeedback
              reserveSpace={false}
              id={lookup.errorId('invoiceId')}
              error={lookup.errors.invoiceId}
              message={t('admin.invoices.error.invoiceId', locale)}
            />
            <FormAlert message={lookup.errors.root?.validation?.message} />
            <Button
              type="submit"
              disabled={readLocked || loading || time.status !== 'ready'}
              aria-busy={loading || lookup.form.formState.isSubmitting || undefined}
            >
              {loading || lookup.form.formState.isSubmitting
                ? t('admin.invoices.loading', locale)
                : t('admin.invoices.load', locale)}
            </Button>
          </form>
        )}
        {invoice && (
          <div className={recordEditorSurface}>
            <RecordEditorSection title={t('admin.invoices.deadlineSource', locale)}>
              <dl className={`${recordEditorGrid} grid-cols-2`}>
                <div className="col-span-2">
                  <dt className="text-sm text-muted-foreground">
                    {t('admin.invoices.loadedId', locale)}
                  </dt>
                  <dd className="text-sm break-all" data-testid="loaded-invoice-id">
                    <bdi dir="ltr" className="font-mono">
                      {invoice.invoiceId}
                    </bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t('admin.invoices.state', locale)}
                  </dt>
                  <dd className="font-medium">
                    {appText(`invoices.state.${invoice.state}`, locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t('admin.invoices.issuedAt', locale)}
                  </dt>
                  <dd>{time.format(invoice.issuedAt)}</dd>
                </div>
                {!invoice.canOverride && (
                  <div>
                    <dt className="text-sm text-muted-foreground">
                      {t('admin.invoices.currentDue', locale)}
                    </dt>
                    <dd>{time.format(invoice.dueAt)}</dd>
                  </div>
                )}
              </dl>
              {invoice.dueAtOverride && (
                <p className="text-sm text-muted-foreground">
                  {t('admin.invoices.previousOverride', locale)}: {invoice.dueAtOverride.reason}
                </p>
              )}
            </RecordEditorSection>
            {!invoice.canOverride ? (
              <p className="px-4 py-3 text-sm text-warning sm:px-6" role="status">
                {t('admin.invoices.notOverrideable', locale)}
              </p>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <RecordEditorSection title={t('admin.invoices.deadlineChange', locale)}>
                  {!canEditTime && <p role="alert">{t('admin.invoices.reloadTimezone', locale)}</p>}
                  <div className="grid gap-3 sm:grid-cols-2 sm:items-start sm:gap-5">
                    <div className={recordEditorField}>
                      <Label htmlFor="due-at">
                        {t('admin.invoices.overrideDue', locale)}{' '}
                        <span className="text-destructive" aria-hidden="true">
                          *
                        </span>
                      </Label>
                      <RecordDateTimeField
                        id="due-at"
                        {...draft.bind('dueAt')}
                        label={t('admin.invoices.overrideDue', locale)}
                        locale={locale}
                        timezone={dueTimezone}
                        aria-required="true"
                        disabled={!canEditTime || locked || loading || unavailable}
                        value={dueLocal}
                        onChange={(value) => {
                          setDueLocal(value);
                          setSaved(false);
                        }}
                        aria-describedby={[
                          'due-at-timezone',
                          draft.errors.dueAt ? draft.errorId('dueAt') : null,
                          'due-at-preview',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      />
                      <p id="due-at-timezone" className="text-sm text-muted-foreground">
                        {t('admin.invoices.accountTimezone', locale)} · <bdi>{dueTimezone}</bdi>
                      </p>
                      <FieldFeedback
                        reserveSpace={false}
                        id={draft.errorId('dueAt')}
                        error={draft.errors.dueAt}
                        message={t('admin.invoices.error.dueAt', locale)}
                      />
                    </div>
                    <dl className="grid min-w-0 grid-cols-2 gap-x-3 rounded-lg border bg-muted/35 px-3 py-2.5">
                      <div className="min-w-0">
                        <dt className="text-xs text-muted-foreground">
                          {t('admin.invoices.currentDue', locale)}
                        </dt>
                        <dd className="text-sm">{time.format(invoice.dueAt)}</dd>
                      </div>
                      <div className="min-w-0 border-s ps-3">
                        <dt className="text-xs text-muted-foreground">
                          {t('admin.invoices.proposedDue', locale)}
                        </dt>
                        <dd
                          id="due-at-preview"
                          aria-live="polite"
                          aria-atomic="true"
                          className="text-sm"
                        >
                          {proposedDue ? (
                            <time dateTime={proposedDue} className="font-semibold text-primary">
                              {time.format(proposedDue)}
                            </time>
                          ) : (
                            <span className="text-muted-foreground">
                              {t('admin.invoices.proposedDueEmpty', locale)}
                            </span>
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className={recordEditorField}>
                    <Label htmlFor="override-reason">
                      {t('admin.invoices.reason', locale)}{' '}
                      <span className="text-destructive" aria-hidden="true">
                        *
                      </span>
                    </Label>
                    <Textarea
                      id="override-reason"
                      {...draft.bind('reason')}
                      required
                      aria-required="true"
                      maxLength={2000}
                      rows={2}
                      placeholder={t('admin.invoices.deadlineReasonExample', locale)}
                      disabled={locked || loading || unavailable}
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setSaved(false);
                      }}
                      aria-describedby={[
                        'override-reason-hint',
                        draft.errors.reason ? draft.errorId('reason') : null,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      className="min-h-14 resize-y"
                    />
                    <p id="override-reason-hint" className="text-xs text-muted-foreground mt-1">
                      {t('admin.invoices.reasonHint', locale)}
                    </p>
                    <FieldFeedback
                      reserveSpace={false}
                      id={draft.errorId('reason')}
                      error={draft.errors.reason}
                      message={t('admin.invoices.error.reason', locale)}
                    />
                  </div>
                  <FormAlert message={draft.errors.root?.validation?.message} />
                </RecordEditorSection>
                <RecordEditorActions
                  secondary={
                    <CommandFeedback
                      as="span"
                      className="text-sm text-success"
                      message={saved ? t('admin.invoices.saved', locale) : null}
                    />
                  }
                >
                  <Button
                    type="submit"
                    ref={submitButton}
                    disabled={locked || loading || unavailable || !canEditTime}
                    aria-busy={saving || undefined}
                  >
                    {saving && (
                      <span
                        aria-hidden="true"
                        className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                      />
                    )}
                    {t(saving ? 'admin.invoices.saving' : 'admin.invoices.submit', locale)}
                  </Button>
                </RecordEditorActions>
              </form>
            )}
          </div>
        )}
      </div>
    </>
  );
}
