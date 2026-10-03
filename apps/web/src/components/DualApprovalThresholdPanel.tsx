import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { isValidDualApprovalThreshold } from '@barghsa/shared/finance';
import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
import { Button } from '@barghsa/ui';
import { z } from 'zod/mini';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useWizardForm as useDraftForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { normalizeIrrAmountDigits } from '../lib/invoice-bank-receipt-upload.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

const path = '/api/admin/config/dual-approval-threshold';
function thresholdValue(raw: string): number {
  const digits = normalizeIrrAmountDigits(raw);
  return /^\d+$/.test(digits) ? Number(digits) : NaN;
}
interface PendingThreshold {
  command: TeamAction;
  value: number;
  generation: number;
}
export default function DualApprovalThresholdPanel() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [current, setCurrent] = useState<number | null>(null);
  const message = t('admin.receiptThreshold.invalid', locale);
  const draft = useDraftForm<{ thresholdIrR: string }>(
    z.object({
      thresholdIrR: z
        .string()
        .check(z.refine((raw) => isValidDualApprovalThreshold(thresholdValue(raw)), message)),
    }),
    { thresholdIrR: '' }
  );
  const [raw, setRaw] = draft.field('thresholdIrR');
  const { reset } = draft.form;
  const applyServerErrors = useActionFieldErrors(draft.form, { thresholdIrR: message }, message);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [action, setAction] = useState<PendingThreshold | null>(null);
  const owner = useRef<PendingThreshold | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(false);
    setCurrent(null);
    owner.current = null;
    setAction(null);
    setSaved(false);
    reset({ thresholdIrR: '' });
    try {
      const response = await fetch(path, { credentials: 'include' });
      const data: unknown = await response.json().catch(() => null);
      if (request !== generation.current) return;
      const denied = response.status === 401 || response.status === 403;
      setForbidden(denied);
      if (denied) return;
      const value = (data as { thresholdIrR?: unknown } | null)?.thresholdIrR;
      if (!response.ok || !isValidDualApprovalThreshold(value)) throw new Error('Unavailable');
      setCurrent(value);
      reset({ thresholdIrR: String(value) });
    } catch {
      if (request === generation.current) setError(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [reset]);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      owner.current = null;
    };
  }, [load]);
  const value = thresholdValue(raw);
  const valid = isValidDualApprovalThreshold(value);
  const available = useRef(false);
  available.current = !loading && !error && !forbidden && current !== null && !action;
  const busy = draft.form.formState.isSubmitting || !!action;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available.current || owner.current || draft.form.isSubmissionPending()) return;
    setSaved(false);
    const request = generation.current;
    await draft.form.handleSubmit(({ thresholdIrR }) => {
      if (!available.current || owner.current || request !== generation.current) return;
      const value = thresholdValue(thresholdIrR);
      const pending: PendingThreshold = {
        value,
        generation: request,
        command: {
          title: t('admin.receiptThreshold.save', locale),
          description: `${numbers.money(value)}. ${t(value === 0 ? 'admin.receiptThreshold.disabled' : 'admin.receiptThreshold.description', locale)}`,
          path,
          method: 'PUT',
          body: { threshold_irr: value },
          requiresOtp: true,
        },
      };
      owner.current = pending;
      setAction(pending);
    })(event);
  }
  function owns(pending: PendingThreshold): boolean {
    return owner.current === pending && generation.current === pending.generation;
  }
  function close(pending: PendingThreshold) {
    if (!owns(pending)) return;
    owner.current = null;
    setAction(null);
  }
  if (forbidden) return null;
  return (
    <section
      aria-labelledby="receipt-threshold-title"
      className="space-y-3 rounded-lg border bg-card p-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h2 id="receipt-threshold-title" className="text-lg font-semibold">
        {t('admin.receiptThreshold.title', locale)}
      </h2>
      <p id="receipt-threshold-hint" className="text-sm">
        {t('admin.receiptThreshold.description', locale)}
      </p>
      <p className="text-sm">{t('admin.receiptThreshold.stepUp', locale)}</p>
      {loading ? (
        <p role="status">{t('admin.walletReceipts.loading', locale)}</p>
      ) : error ? (
        <div>
          <p role="alert">{t('admin.receiptThreshold.unavailable', locale)}</p>
          <button type="button" className="underline" onClick={() => void load()}>
            {t('admin.receiptThreshold.retry', locale)}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-3" aria-busy={busy || undefined}>
          <label htmlFor="receipt-threshold" className="block text-sm font-medium">
            {t('admin.receiptThreshold.label', locale)}
          </label>
          <input
            id="receipt-threshold"
            {...draft.bind('thresholdIrR')}
            inputMode="numeric"
            dir="ltr"
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value);
              setSaved(false);
            }}
            disabled={busy}
            aria-describedby={`receipt-threshold-hint receipt-threshold-value${draft.errors.thresholdIrR ? ` ${draft.errorId('thresholdIrR')}` : ''}`}
            className="w-full rounded border bg-background px-3 py-2 text-foreground"
          />
          <p id="receipt-threshold-value" className="text-xl font-semibold">
            {valid ? numbers.money(value) : '—'}
          </p>
          <p
            id={draft.errorId('thresholdIrR')}
            role={draft.errors.thresholdIrR ? 'alert' : undefined}
            aria-hidden={!draft.errors.thresholdIrR || undefined}
            className={`text-sm text-destructive${draft.errors.thresholdIrR ? '' : ' invisible'}`}
          >
            {draft.errors.thresholdIrR?.message ?? message}
          </p>
          {value === 0 && <p>{t('admin.receiptThreshold.disabled', locale)}</p>}
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {t('admin.receiptThreshold.save', locale)}
          </Button>
        </form>
      )}
      {saved && <p role="status">{t('admin.receiptThreshold.saved', locale)}</p>}
      {action && (
        <TeamActionDialog
          action={action.command}
          onClose={() => close(action)}
          onValidationError={(fields) => owns(action) && applyServerErrors(fields)}
          onDenied={() => {
            if (!owns(action)) return;
            generation.current++;
            owner.current = null;
            setCurrent(null);
            reset({ thresholdIrR: '' });
            setAction(null);
            setSaved(false);
            setForbidden(true);
          }}
          onSuccess={async (result) => {
            if (!owns(action)) return;
            const value = (result as { thresholdIrR?: unknown } | null)?.thresholdIrR;
            if (!isValidDualApprovalThreshold(value) || value !== action.value)
              throw new Error('Invalid configuration response');
            setCurrent(value);
            reset({ thresholdIrR: String(value) });
            setSaved(true);
          }}
        />
      )}
    </section>
  );
}
