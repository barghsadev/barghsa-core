import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, Field, FieldLabel, Input, PageLoading } from '@barghsa/ui';
import { tInvoiceCorrections as t } from '@barghsa/i18n/invoice-corrections';
import { t as appText } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';
import { useInvoiceLookupForm } from '../hooks/useInvoiceLookupForm.js';
import {
  RefundFieldFeedback as InvoiceFieldFeedback,
  RefundFormAlert as InvoiceFormAlert,
} from './RefundFormFeedback.js';
import type { InvoiceCorrectionSource } from './ManualInvoiceForm.js';
const ManualInvoiceForm = lazy(() => import('./ManualInvoiceForm.js'));

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
  const lookup = useInvoiceLookupForm(t('invoiceIdInvalid', locale)!);
  const [invoiceId, setInvoiceId] = lookup.field('invoiceId');
  const [source, setSource] = useState<InvoiceCorrectionSource | null>(null);
  const [loading, setLoading] = useState(false),
    [locked, setLocked] = useState(false),
    [error, setError] = useState<'error' | 'denied' | null>(null);
  const lockedRef = useRef(false);
  const loadPending = useRef<number | null>(null);
  const loadedId = useRef('');
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      ++generation.current;
      abort.current?.abort();
    },
    []
  );
  const correction = useMemo(
    () =>
      source
        ? {
            ...source,
            kind: (BigInt(source.paidAmount) > 0n ? 'adjustment' : 'replacement') as
              'adjustment' | 'replacement',
            unavailable: loading || !!error,
            onLocked: (value: boolean) => {
              lockedRef.current = value;
              setLocked(value);
            },
            onDenied: () => {
              ++generation.current;
              loadPending.current = null;
              abort.current?.abort();
              setSource(null);
              loadedId.current = '';
              lookup.form.reset({ invoiceId: '' });
              lockedRef.current = false;
              setLocked(false);
              setLoading(false);
              setError('denied');
            },
          }
        : undefined,
    [source, loading, error]
  );
  const allowed =
    correction &&
    (correction.kind === 'replacement'
      ? ['Draft', 'Unpaid', 'Overdue']
      : ['Paid', 'PartiallyFunded', 'Overdue', 'PartiallyRefunded', 'Refunded']
    ).includes(correction.state);
  async function load(event: FormEvent) {
    event.preventDefault();
    if (lockedRef.current || loadPending.current !== null) return;
    abort.current?.abort();
    const request = new AbortController(),
      owner = ++generation.current;
    loadPending.current = owner;
    abort.current = request;
    setLoading(true);
    setError(null);
    try {
      await lookup.form.handleSubmit(async (values) => {
        if (owner !== generation.current) return;
        const id = values.invoiceId.trim().toLowerCase();
        if (loadedId.current !== id) setSource(null);
        try {
          const response = await fetch(`/api/admin/invoices/${id}/corrections`, {
            signal: request.signal,
          });
          const data: unknown = await response.json();
          if (owner !== generation.current) return;
          if ([401, 403, 404].includes(response.status)) {
            setSource(null);
            loadedId.current = '';
            setError('denied');
            return;
          }
          if (!response.ok || !isSource(data, id)) throw Error('Invalid invoice');
          loadedId.current = id;
          setSource(data);
        } catch {
          if (owner === generation.current) setError('error');
        }
      })();
    } finally {
      if (loadPending.current === owner) loadPending.current = null;
      if (owner === generation.current) setLoading(false);
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
      <form
        onSubmit={load}
        noValidate
        className="space-y-3"
        aria-busy={loading || lookup.form.formState.isSubmitting || undefined}
      >
        <Field data-disabled={locked}>
          <FieldLabel htmlFor="correction-invoice-id">{t('invoiceId', locale)}</FieldLabel>
          <Input
            id="correction-invoice-id"
            {...lookup.bind('invoiceId')}
            dir="ltr"
            autoComplete="off"
            value={invoiceId}
            disabled={locked}
            onChange={(event) => {
              ++generation.current;
              loadPending.current = null;
              abort.current?.abort();
              setLoading(false);
              setSource(null);
              loadedId.current = '';
              setError(null);
              setInvoiceId(event.target.value);
            }}
          />
          <InvoiceFieldFeedback
            id={lookup.errorId('invoiceId')}
            error={lookup.errors.invoiceId}
            message={t('invoiceIdInvalid', locale)!}
          />
        </Field>
        <InvoiceFormAlert message={lookup.errors.root?.validation?.message} />
        <Button type="submit" variant="outline" disabled={locked || loading}>
          {loading && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
            />
          )}
          {t(loading ? 'loading' : 'load', locale)}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-destructive">
          {t(error === 'denied' ? 'denied' : 'loadError', locale)}
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
          <Suspense fallback={<PageLoading label={t('loading', locale)!} />}>
            <ManualInvoiceForm
              key={correction.invoiceId + ':' + correction.kind + ':' + correction.profileId}
              correction={correction}
            />
          </Suspense>
        ) : (
          <p role="status">{t('unavailable', locale)}</p>
        ))}
    </section>
  );
}
