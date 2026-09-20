import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { isValidDualApprovalThreshold } from '@barghsa/shared/finance';
import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { normalizeIrrAmountDigits } from '../lib/invoice-bank-receipt-upload.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

const path = '/api/admin/config/dual-approval-threshold';
export default function DualApprovalThresholdPanel() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [current, setCurrent] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(false);
    setCurrent(null);
    try {
      const response = await fetch(path, { credentials: 'include' });
      const data: unknown = await response.json().catch(() => null);
      if (request !== generation.current) return;
      setForbidden(response.status === 403);
      if (response.status === 403) return;
      const value = (data as { thresholdIrR?: unknown } | null)?.thresholdIrR;
      if (!response.ok || !isValidDualApprovalThreshold(value)) throw new Error('Unavailable');
      setCurrent(value);
      setDraft(String(value));
    } catch {
      if (request === generation.current) setError(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
    };
  }, [load]);
  const digits = normalizeIrrAmountDigits(draft);
  const value = /^\d+$/.test(digits) ? Number(digits) : NaN;
  const valid = isValidDualApprovalThreshold(value);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || loading || current === null || action) return;
    setSaved(false);
    setAction({
      title: t('admin.receiptThreshold.save', locale),
      description: `${numbers.money(value)}. ${t(value === 0 ? 'admin.receiptThreshold.disabled' : 'admin.receiptThreshold.description', locale)}`,
      path,
      method: 'PUT',
      body: { threshold_irr: value },
      requiresPassword: true,
    });
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
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="receipt-threshold" className="block text-sm font-medium">
            {t('admin.receiptThreshold.label', locale)}
          </label>
          <input
            id="receipt-threshold"
            inputMode="numeric"
            dir="ltr"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
            }}
            disabled={!!action}
            aria-invalid={!valid}
            aria-describedby="receipt-threshold-hint receipt-threshold-value"
            className="w-full rounded border bg-background px-3 py-2 text-foreground"
          />
          <p id="receipt-threshold-value" className="text-xl font-semibold">
            {valid ? numbers.money(value) : t('admin.receiptThreshold.invalid', locale)}
          </p>
          {value === 0 && <p>{t('admin.receiptThreshold.disabled', locale)}</p>}
          <button
            type="submit"
            disabled={!valid || !!action}
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          >
            {t('admin.receiptThreshold.save', locale)}
          </button>
        </form>
      )}
      {saved && <p role="status">{t('admin.receiptThreshold.saved', locale)}</p>}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            const value = (result as { thresholdIrR?: unknown } | null)?.thresholdIrR;
            if (!isValidDualApprovalThreshold(value))
              throw new Error('Invalid configuration response');
            setCurrent(value);
            setDraft(String(value));
            setSaved(true);
          }}
        />
      )}
    </section>
  );
}
