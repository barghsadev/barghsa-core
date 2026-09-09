import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, Field, FieldLabel, Input } from '@barghsa/ui';
import { tInvoiceCorrections as t } from '@barghsa/i18n/invoice-corrections';
import { t as appText } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';
import { ManualInvoiceForm, type InvoiceCorrectionSource } from './ManualInvoicePanel.js';

function isSource(value: unknown, id: string): value is InvoiceCorrectionSource {
  if (!value || typeof value !== 'object') return false;
  const item = value as InvoiceCorrectionSource;
  return (
    item.invoiceId === id &&
    isInvoiceUuid(item.profileId) &&
    typeof item.state === 'string' &&
    typeof item.paidAmount === 'string' &&
    /^\d{1,19}$/.test(item.paidAmount) &&
    typeof item.totalAmount === 'string' &&
    /^\d{1,19}$/.test(item.totalAmount) &&
    Array.isArray(item.lines) &&
    item.lines.length <= 100 &&
    item.lines.every(
      (line) =>
        line &&
        typeof line.description === 'string' &&
        line.description.length <= 1000 &&
        Number.isInteger(line.quantity) &&
        line.quantity >= 1 &&
        line.quantity <= 2147483647 &&
        typeof line.unitPrice === 'string' &&
        /^\d{1,19}$/.test(line.unitPrice) &&
        Number.isInteger(line.vatRate) &&
        line.vatRate >= 0 &&
        line.vatRate <= 10000 &&
        typeof line.isTaxable === 'boolean'
    )
  );
}
export default function InvoiceCorrectionsPanel() {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const [invoiceId, setInvoiceId] = useState('');
  const [source, setSource] = useState<InvoiceCorrectionSource | null>(null);
  const [loading, setLoading] = useState(false),
    [locked, setLocked] = useState(false),
    [error, setError] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const correction = useMemo(
    () =>
      source
        ? {
            ...source,
            kind: (BigInt(source.paidAmount) > 0n ? 'adjustment' : 'replacement') as
              'adjustment' | 'replacement',
            onLocked: setLocked,
          }
        : undefined,
    [source]
  );
  const allowed =
    correction &&
    (correction.kind === 'replacement'
      ? ['Draft', 'Unpaid', 'Overdue']
      : ['Paid', 'PartiallyFunded', 'Overdue', 'PartiallyRefunded', 'Refunded']
    ).includes(correction.state);
  async function load(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    abort.current?.abort();
    const request = new AbortController();
    abort.current = request;
    setSource(null);
    setError(false);
    const id = invoiceId.trim().toLowerCase();
    if (!isInvoiceUuid(id)) {
      setError(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/invoices/${id}/corrections`, {
        signal: request.signal,
      });
      const data: unknown = await response.json();
      if (!response.ok || !isSource(data, id)) throw new Error('Invalid invoice');
      if (!request.signal.aborted) setSource(data);
    } catch {
      if (!request.signal.aborted) setError(true);
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }
  return (
    <section
      id="invoice-corrections-panel"
      className="rounded-lg border bg-card p-6 text-card-foreground space-y-5"
      aria-labelledby="invoice-corrections-heading"
    >
      <header className="space-y-2">
        <h2 id="invoice-corrections-heading" className="text-xl font-semibold">
          {t('title', locale)}
        </h2>
        <p className="text-sm text-muted-foreground">{t('description', locale)}</p>
      </header>
      <form onSubmit={load} className="space-y-3">
        <Field data-disabled={locked}>
          <FieldLabel htmlFor="correction-invoice-id">{t('invoiceId', locale)}</FieldLabel>
          <Input
            id="correction-invoice-id"
            dir="ltr"
            autoComplete="off"
            value={invoiceId}
            disabled={locked}
            onChange={(event) => {
              abort.current?.abort();
              setLoading(false);
              setSource(null);
              setError(false);
              setInvoiceId(event.target.value);
            }}
          />
        </Field>
        <Button type="submit" variant="outline" disabled={locked || loading}>
          {t(loading ? 'loading' : 'load', locale)}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-destructive">
          {t('loadError', locale)}
        </p>
      )}
      {source && (
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">{t('source', locale)}</dt>
            <dd>
              <bdi>{source.invoiceId}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('state', locale)}</dt>
            <dd>{appText(`invoices.state.${source.state}`, locale)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('paid', locale)}</dt>
            <dd>{numbers.money(source.paidAmount)}</dd>
          </div>
        </dl>
      )}
      {correction &&
        (allowed ? (
          <ManualInvoiceForm key={correction.invoiceId} correction={correction} />
        ) : (
          <p role="status">{t('unavailable', locale)}</p>
        ))}
    </section>
  );
}
