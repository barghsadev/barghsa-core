import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import type { InvoiceDueAtOverrideSnapshot } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useInvoiceLookupForm } from '../hooks/useInvoiceLookupForm.js';
import { useDeadlineForm } from '../hooks/useDeadlineForms.js';
import { withCsrf } from '../lib/csrf.js';
import { authErrorCode } from '../lib/auth-errors.js';
import {
  deadlineInstant,
  isoToDatetimeLocal,
  lookupMatchesLoadedInvoice,
} from '../lib/due-at-override.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import {
  RefundFieldFeedback as FieldFeedback,
  RefundFormAlert as FormAlert,
} from './RefundFormFeedback.js';
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
export default function InvoiceDueAtPanel({
  selection,
}: {
  selection: { invoiceId: string; revision: number } | null;
}) {
  const locale = useLocale(),
    time = useAccountTime();
  const [dueTimezone, setDueTimezone] = useState('');
  const [invoice, setInvoice] = useState<InvoiceDueAtDto | null>(null);
  const lookup = useInvoiceLookupForm(t('admin.invoices.error.invoiceId', locale));
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
  const invalidFocus = useRef<'dueAt' | 'reason' | null>(null);
  useEffect(() => {
    if (!saving && invalidFocus.current) {
      draft.form.setFocus(invalidFocus.current);
      invalidFocus.current = null;
    }
  }, [saving, draft.form]);
  const submitButton = useRef<HTMLButtonElement>(null);
  const canEditTime = time.status === 'ready' && dueTimezone === time.timezone;
  const locked = saving || Boolean(pendingAction),
    readLocked = locked || (lookup.form.formState.isSubmitting && !loading);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current++;
      loadVersion.current++;
    };
  }, []);
  function clearWork() {
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
      generation.current++;
      loadVersion.current++;
      inFlight.current = false;
      setSaving(false);
      setLoading(false);
      setPendingAction(null);
      setUnavailable(true);
    }
  }, [time.status, time.timezone, dueTimezone]);
  const current = (owner: number) => live.current && owner === generation.current;
  function handleInvoiceIdChange(next: string) {
    if (inFlight.current || pendingAction || (lookup.form.isSubmissionPending() && !loading))
      return;
    loadVersion.current++;
    setLoading(false);
    setInvoiceId(next);
    setError(null);
    if (invoice && !lookupMatchesLoadedInvoice(next, invoice.invoiceId)) clearWork();
  }
  async function loadInvoice(event: FormEvent) {
    event.preventDefault();
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
      setLoading(true);
      setUnavailable(true);
      setError(null);
      setSaved(false);
      try {
        const response = await fetch(`/api/admin/invoices/${id}/due-at`, {
          credentials: 'include',
        });
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
          const response = await fetch(path, {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
          });
          const data: unknown = await response.json().catch(() => null);
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
            throw new Error('save');
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
      if (current(owner)) setError(t('admin.invoices.error.save', locale));
    } finally {
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
          confirmationDisabled={!canEditTime || unavailable}
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
        className="max-w-xl space-y-6"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <header>
          <h2 className="text-2xl font-bold">{t('admin.invoices.title', locale)}</h2>
          <p className="text-muted-foreground mt-2">{t('admin.invoices.description', locale)}</p>
        </header>
        <FormAlert message={error ?? undefined} />
        <form
          onSubmit={loadInvoice}
          noValidate
          className="bg-card text-card-foreground rounded-lg border border-border p-6 space-y-3"
        >
          <div>
            <label htmlFor="invoice-id" className="block text-sm font-medium text-foreground mb-1">
              {t('admin.invoices.invoiceId', locale)}
            </label>
            <input
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
              className="w-full border border-input bg-background text-foreground rounded px-3 py-2 font-mono text-sm"
              dir="ltr"
            />
            <p id="invoice-id-hint" className="text-xs text-muted-foreground mt-1">
              {t('admin.invoices.invoiceIdHint', locale)}
            </p>
          </div>
          <FieldFeedback
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
        {invoice && (
          <section
            className="bg-card text-card-foreground rounded-lg border border-border p-6 space-y-4"
            aria-labelledby="override-heading"
          >
            <h2 id="override-heading" className="text-lg font-semibold">
              {t('admin.invoices.title', locale)}
            </h2>
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">{t('admin.invoices.loadedId', locale)}</dt>
                <dd
                  className="font-mono text-sm break-all"
                  dir="ltr"
                  data-testid="loaded-invoice-id"
                >
                  {invoice.invoiceId}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('admin.invoices.state', locale)}</dt>
                <dd className="font-medium">
                  {appText(`invoices.state.${invoice.state}`, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('admin.invoices.issuedAt', locale)}</dt>
                <dd>{time.format(invoice.issuedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('admin.invoices.currentDue', locale)}</dt>
                <dd>{time.format(invoice.dueAt)}</dd>
              </div>
            </dl>
            {invoice.dueAtOverride && (
              <p className="text-sm text-muted-foreground">
                {t('admin.invoices.previousOverride', locale)}: {invoice.dueAtOverride.reason}
              </p>
            )}
            {!invoice.canOverride ? (
              <p className="text-sm text-warning" role="status">
                {t('admin.invoices.notOverrideable', locale)}
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <p id="due-at-timezone">
                  {t('admin.invoices.accountTimezone', locale)}: {dueTimezone}
                </p>
                {!canEditTime && <p role="alert">{t('admin.invoices.reloadTimezone', locale)}</p>}
                <div>
                  <label
                    htmlFor="due-at"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    {t('admin.invoices.overrideDue', locale)}{' '}
                    <span className="text-destructive" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <input
                    id="due-at"
                    {...draft.bind('dueAt')}
                    type="datetime-local"
                    required
                    aria-required="true"
                    disabled={!canEditTime || locked || loading || unavailable}
                    value={dueLocal}
                    onChange={(e) => {
                      setDueLocal(e.target.value);
                      setSaved(false);
                    }}
                    aria-describedby={[
                      'due-at-timezone',
                      draft.errors.dueAt ? draft.errorId('dueAt') : null,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    className="w-full border border-input bg-background text-foreground rounded px-3 py-2"
                    dir="ltr"
                  />
                  <FieldFeedback
                    id={draft.errorId('dueAt')}
                    error={draft.errors.dueAt}
                    message={t('admin.invoices.error.dueAt', locale)}
                  />
                </div>
                <div>
                  <label
                    htmlFor="override-reason"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    {t('admin.invoices.reason', locale)}{' '}
                    <span className="text-destructive" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <textarea
                    id="override-reason"
                    {...draft.bind('reason')}
                    required
                    aria-required="true"
                    maxLength={2000}
                    rows={4}
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
                    className="w-full border border-input bg-background text-foreground rounded px-3 py-2"
                  />
                  <p id="override-reason-hint" className="text-xs text-muted-foreground mt-1">
                    {t('admin.invoices.reasonHint', locale)}
                  </p>
                  <FieldFeedback
                    id={draft.errorId('reason')}
                    error={draft.errors.reason}
                    message={t('admin.invoices.error.reason', locale)}
                  />
                </div>
                <FormAlert message={draft.errors.root?.validation?.message} />
                <div className="flex items-center gap-3">
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
                  {saved && (
                    <span className="text-sm text-success" role="status">
                      {t('admin.invoices.saved', locale)}
                    </span>
                  )}
                </div>
              </form>
            )}
          </section>
        )}
      </div>
    </>
  );
}
