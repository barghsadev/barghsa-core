import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import {
  DUE_AT_OVERRIDE_REASON_MAX_LENGTH,
  parseDueAtOverrideBody,
  type InvoiceDueAtOverrideSnapshot,
} from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { authErrorCode } from '../lib/auth-errors.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import {
  datetimeLocalToIso,
  isInvoiceUuid,
  isoToDatetimeLocal,
  lookupMatchesLoadedInvoice,
} from '../lib/due-at-override.js';
import ReminderOffsetTogglePanel from '../components/ReminderOffsetTogglePanel.js';
import ManualInvoicePanel from '../components/ManualInvoicePanel.js';
import ServiceDuePeriodPanel from '../components/ServiceDuePeriodPanel.js';

/**
 * Staff dueAt override page (T-04.1.03.03).
 *
 * Finance staff load an invoice, enter a new due datetime and a required
 * customer-visible reason, and submit. The API stores the reason in
 * invoice metadata and the append-only audit log.
 */

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

export default function AdminInvoicesPage() {
  const time = useAccountTime();
  const [dueTimezone, setDueTimezone] = useState('');
  const canEditTime = time.status === 'ready' && dueTimezone === time.timezone;
  const locale = useLocale();
  const [invoiceId, setInvoiceId] = useState('');
  const [invoice, setInvoice] = useState<InvoiceDueAtDto | null>(null);
  const [dueLocal, setDueLocal] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientIssue, setClientIssue] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    (TeamAction & { invoiceId: string; dueAt: string; reason: string; timezone: string }) | null
  >(null);
  const loadVersion = useRef(0),
    inFlight = useRef(false);
  const submitButton = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      loadVersion.current++;
    },
    []
  );
  const locked = saving || Boolean(pendingAction);

  async function loadInvoice(e?: FormEvent) {
    e?.preventDefault();
    if (time.status !== 'ready' || inFlight.current || pendingAction) return;
    setError(null);
    setSaved(false);
    setClientIssue(null);
    const id = invoiceId.trim();
    if (!isInvoiceUuid(id)) {
      setClientIssue(t('admin.invoices.error.invoiceId', locale));
      return;
    }
    const version = ++loadVersion.current;
    setInvoice(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/invoices/${id}/due-at`);
      if (!res.ok) throw new Error(t('admin.invoices.error.load', locale));
      const data: unknown = await res.json();
      if (version !== loadVersion.current) return;
      if (!isInvoiceResponse(data, id)) throw new Error(t('admin.invoices.error.load', locale));
      setInvoice(data);
      setDueLocal(isoToDatetimeLocal(data.dueAt, time.timezone));
      setDueTimezone(time.timezone);
      setReason(data.dueAtOverride?.reason ?? '');
    } catch {
      if (version !== loadVersion.current) return;
      setInvoice(null);
      setError(t('admin.invoices.error.load', locale));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }

  function discardLoadedInvoice() {
    setInvoice(null);
    setDueLocal('');
    setReason('');
    setSaved(false);
    setClientIssue(null);
  }

  function handleInvoiceIdChange(next: string) {
    if (inFlight.current || pendingAction) return;
    loadVersion.current++;
    setLoading(false);
    setInvoiceId(next);
    if (invoice && !lookupMatchesLoadedInvoice(next, invoice.invoiceId)) {
      discardLoadedInvoice();
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current || pendingAction) return;
    setSaved(false);
    setClientIssue(null);
    setError(null);
    if (!invoice || !canEditTime) return;
    if (!lookupMatchesLoadedInvoice(invoiceId, invoice.invoiceId)) {
      discardLoadedInvoice();
      return;
    }

    // Preserve the original instant when the displayed minute was not edited, including DST folds.
    const iso =
      dueLocal === isoToDatetimeLocal(invoice.dueAt, dueTimezone)
        ? invoice.dueAt
        : datetimeLocalToIso(dueLocal, dueTimezone);
    if (!iso) {
      setClientIssue(t('admin.invoices.error.dueAt', locale));
      return;
    }
    const parsed = parseDueAtOverrideBody({ dueAt: iso, reason });
    if (!parsed.ok) {
      setClientIssue(
        parsed.issues.some((i) => i.toLowerCase().includes('reason'))
          ? t('admin.invoices.error.reason', locale)
          : t('admin.invoices.error.dueAt', locale)
      );
      return;
    }

    const submitted = {
      invoiceId: invoice.invoiceId,
      dueAt: parsed.value.dueAt.toISOString(),
      reason: parsed.value.reason,
      timezone: dueTimezone,
    };
    inFlight.current = true;
    setSaving(true);
    try {
      const path = `/api/admin/invoices/${submitted.invoiceId}/due-at`;
      const body = { dueAt: submitted.dueAt, reason: submitted.reason };
      const res = await fetch(path, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json();
      if (res.status === 403 && authErrorCode(data) === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code) {
        setPendingAction({
          ...submitted,
          path,
          method: 'POST',
          body,
          requiresPassword: true,
          title: t('admin.invoices.stepUp.title', locale),
          description: t('admin.invoices.stepUp.description', locale),
        });
        return;
      }
      if (!res.ok) throw new Error(t('admin.invoices.error.save', locale));
      acceptOverride(data, submitted);
    } catch {
      setError(t('admin.invoices.error.save', locale));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function acceptOverride(
    data: unknown,
    submitted: { invoiceId: string; dueAt: string; reason: string; timezone: string }
  ) {
    if (
      !isInvoiceResponse(data, submitted.invoiceId) ||
      data.dueAt !== submitted.dueAt ||
      data.dueAtOverride?.reason !== submitted.reason
    ) {
      throw new Error(t('admin.invoices.error.save', locale));
    }
    setInvoice(data);
    setDueLocal(isoToDatetimeLocal(data.dueAt, submitted.timezone));
    setDueTimezone(submitted.timezone);
    setReason(submitted.reason);
    setSaved(true);
  }

  return (
    <div className="max-w-4xl space-y-8">
      <h1 className="text-2xl font-bold">{t('admin.invoices.nav', locale)}</h1>
      <ManualInvoicePanel />
      {pendingAction && (
        <TeamActionDialog
          action={pendingAction}
          finalFocus={submitButton}
          onClose={() => setPendingAction(null)}
          onSuccess={async (data) => {
            acceptOverride(data, pendingAction);
          }}
        />
      )}

      {time.notice}
      <ReminderOffsetTogglePanel />
      <ServiceDuePeriodPanel />

      <div id="invoice-deadline-panel" className="max-w-xl space-y-6">
        <header>
          <h2 className="text-2xl font-bold">{t('admin.invoices.title', locale)}</h2>
          <p className="text-muted-foreground mt-2">{t('admin.invoices.description', locale)}</p>
        </header>

        {error && (
          <div
            className="bg-destructive/10 border border-destructive/40 text-destructive px-4 py-3 rounded"
            role="alert"
          >
            {error}
          </div>
        )}

        <form
          onSubmit={loadInvoice}
          className="bg-card text-card-foreground rounded-lg border border-border p-6 space-y-3"
        >
          <div>
            <label htmlFor="invoice-id" className="block text-sm font-medium text-foreground mb-1">
              {t('admin.invoices.invoiceId', locale)}
            </label>
            <input
              id="invoice-id"
              name="invoiceId"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              required
              aria-required="true"
              aria-describedby="invoice-id-hint"
              disabled={locked}
              value={invoiceId}
              onChange={(e) => handleInvoiceIdChange(e.target.value)}
              className="w-full border border-input bg-background text-foreground rounded px-3 py-2 font-mono text-sm"
              dir="ltr"
            />
            <p id="invoice-id-hint" className="text-xs text-muted-foreground mt-1">
              {t('admin.invoices.invoiceIdHint', locale)}
            </p>
          </div>
          <button
            type="submit"
            disabled={locked || loading || time.status !== 'ready'}
            className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900 disabled:opacity-50"
          >
            {loading ? t('admin.invoices.loading', locale) : t('admin.invoices.load', locale)}
          </button>
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
                <dd className="font-mono text-sm" dir="ltr" data-testid="loaded-invoice-id">
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
              <p className="text-sm text-amber-700 dark:text-amber-300" role="status">
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
                    name="dueAt"
                    type="datetime-local"
                    required
                    aria-required="true"
                    disabled={!canEditTime || locked}
                    aria-describedby="due-at-timezone"
                    value={dueLocal}
                    onChange={(e) => setDueLocal(e.target.value)}
                    className="w-full border border-input bg-background text-foreground rounded px-3 py-2"
                    dir="ltr"
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
                    name="reason"
                    required
                    aria-required="true"
                    aria-describedby="override-reason-hint"
                    maxLength={DUE_AT_OVERRIDE_REASON_MAX_LENGTH}
                    rows={4}
                    disabled={locked}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full border border-input bg-background text-foreground rounded px-3 py-2"
                  />
                  <p id="override-reason-hint" className="text-xs text-muted-foreground mt-1">
                    {t('admin.invoices.reasonHint', locale)}
                  </p>
                </div>

                {clientIssue && (
                  <p className="text-sm text-destructive" role="alert">
                    {clientIssue}
                  </p>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    ref={submitButton}
                    disabled={locked || !canEditTime}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving
                      ? t('admin.invoices.saving', locale)
                      : t('admin.invoices.submit', locale)}
                  </button>
                  {saved && (
                    <span className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
                      {t('admin.invoices.saved', locale)}
                    </span>
                  )}
                </div>
              </form>
            )}
          </section>
        )}

        {clientIssue && !invoice && (
          <p className="text-sm text-destructive" role="alert">
            {clientIssue}
          </p>
        )}
      </div>
    </div>
  );
}
