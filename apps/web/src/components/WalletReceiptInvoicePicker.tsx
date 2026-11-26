import { useEffect, useId, useRef, useState } from 'react';
import { Button, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { receiptEditorMessages } from '@barghsa/i18n/receipt-editor';
import {
  isBankReceiptInvoiceLinkAllowedState,
  remainingForBankReceiptSettlement,
} from '@barghsa/shared/finance';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useFinancialFormatting } from '../hooks/useFinancialFormatting.js';
import { useLocale } from '../hooks/useLocale.js';
import { staffQueryJson, useStaffQueryRead } from '../hooks/useStaffQueryRead.js';
import type { WizardFieldBinding } from '../hooks/useWizardForm.js';
import { isTransactionUuid } from '../lib/bank-receipt-confirmation.js';
import { decodeFinanceCursor, type FinanceCursor } from '../lib/finance-list-query.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { CatalogueChoicePicker } from './CatalogueChoicePicker.js';
import { recordEditorField } from './RecordEditorLayout.js';

interface InvoiceChoice {
  invoiceId: string;
  profileId: string;
  state: string;
  totalAmount: string;
  paidAmount: string;
  createdAt: string;
  dueAt?: string | null;
}

const wallet = 'wallet';

function eligibleInvoice(value: unknown, profileId: string): value is InvoiceChoice {
  const invoice = value as Partial<InvoiceChoice> | null;
  return Boolean(
    invoice?.profileId === profileId &&
    typeof invoice.invoiceId === 'string' &&
    isTransactionUuid(invoice.invoiceId) &&
    typeof invoice.state === 'string' &&
    isBankReceiptInvoiceLinkAllowedState(invoice.state) &&
    typeof invoice.totalAmount === 'string' &&
    /^\d+$/.test(invoice.totalAmount) &&
    typeof invoice.paidAmount === 'string' &&
    /^\d+$/.test(invoice.paidAmount) &&
    typeof invoice.createdAt === 'string' &&
    Number.isFinite(Date.parse(invoice.createdAt))
  );
}

export function WalletReceiptInvoicePicker({
  profileId,
  field,
  value,
  onValueChange,
  onManualEntry,
  disabled,
  error,
}: {
  profileId: string;
  field: WizardFieldBinding;
  value: string;
  onValueChange: (value: string) => void;
  onManualEntry: () => void;
  disabled: boolean;
  error: string | undefined;
}) {
  const id = useId();
  const locale = useLocale();
  const copy = receiptEditorMessages[locale];
  const { format } = useAccountTime(locale);
  const { money } = useFinancialFormatting(locale);
  const read = useStaffQueryRead('invoices');
  const [choices, setChoices] = useState<InvoiceChoice[]>([]);
  const [nextCursor, setNextCursor] = useState<FinanceCursor | null>(null);
  const [cursor, setCursor] = useState<FinanceCursor | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'denied' | 'ready'>('loading');
  const refocus = useRef(false);
  const retryButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!refocus.current || status === 'loading') return;
    refocus.current = false;
    if (status === 'ready') document.getElementById(id)?.focus();
    else if (status === 'unavailable') retryButton.current?.focus();
  }, [id, status]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ profileId });
    if (cursor) {
      query.set('beforeAt', cursor.beforeAt);
      query.set('beforeId', cursor.beforeId);
    }
    setStatus('loading');
    void read(`/api/admin/invoices/ledger?${query}`, 'list', controller.signal, staffQueryJson)
      .then((data) => {
        if (controller.signal.aborted) return;
        const page = data as { items?: unknown[]; nextCursor?: FinanceCursor | null } | null;
        if (!Array.isArray(page?.items) || page.items.length > 25)
          throw new Error('Invalid invoice list');
        const next = decodeFinanceCursor([page.nextCursor?.beforeAt, page.nextCursor?.beforeId]);
        const matching = page.items.filter((row) => eligibleInvoice(row, profileId));
        setChoices((previous) =>
          cursor
            ? [...new Map([...previous, ...matching].map((row) => [row.invoiceId, row])).values()]
            : matching
        );
        setNextCursor(next?.beforeId === cursor?.beforeId ? null : next);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ServerQueryError && [401, 403, 404].includes(error.status)) {
          setChoices([]);
          setNextCursor(null);
          setStatus('denied');
        } else {
          setStatus('unavailable');
        }
      });
    return () => controller.abort();
  }, [profileId, read, cursor, attempt]);

  const options = [
    { id: wallet, title: copy.walletCredit },
    ...choices.map((invoice) => {
      const remaining = remainingForBankReceiptSettlement({
        state: invoice.state,
        totalAmount: BigInt(invoice.totalAmount),
        paidAmount: BigInt(invoice.paidAmount),
      });
      const dueAt =
        typeof invoice.dueAt === 'string' && Number.isFinite(Date.parse(invoice.dueAt))
          ? invoice.dueAt
          : null;
      const stamp = dueAt ?? invoice.createdAt;
      const date = format(stamp, { dateStyle: 'medium' });
      const state = t(`invoices.state.${invoice.state}`, locale);
      return {
        id: invoice.invoiceId,
        title: `${money(remaining)} · …${invoice.invoiceId.slice(-12)}`,
        detail: `${state} · ${dueAt ? copy.invoiceChoiceDue : copy.invoiceChoiceCreated} ${date}`,
        searchText: `${invoice.invoiceId} ${remaining} ${stamp.slice(0, 10)} ${date} ${state}`,
      };
    }),
  ];

  return (
    <div className={recordEditorField}>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <Label htmlFor={id}>{copy.invoiceDestination}</Label>
        <Button
          type="button"
          variant="link"
          className="px-0"
          disabled={disabled}
          onClick={onManualEntry}
        >
          {copy.useInvoiceId}
        </Button>
      </div>
      <CatalogueChoicePicker
        id={id}
        locale={locale}
        options={options}
        selected={value || wallet}
        disabled={disabled}
        required={false}
        field={{
          ...field,
          'aria-invalid': Boolean(error) || undefined,
          'aria-describedby': `${id}-hint${error ? ` ${id}-error` : ''}`,
        }}
        labels={{
          search: copy.invoiceChoiceSearch,
          noMatches: copy.invoiceChoiceNoMatches,
          empty: copy.invoiceChoiceNone,
          unavailable: `…${value.trim().slice(-12)}`,
        }}
        onChange={(invoiceId) => onValueChange(invoiceId === wallet ? '' : invoiceId)}
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {copy.invoiceChoiceHelp}
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {status === 'loading' && (
        <p role="status" className="text-sm text-muted-foreground">
          {copy.invoiceChoicesLoading}
        </p>
      )}
      {status === 'unavailable' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-danger-soft p-2.5">
          <p role="alert" className="min-w-0 text-sm text-destructive">
            {copy.invoiceChoiceError}
          </p>
          <Button
            ref={retryButton}
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11"
            disabled={disabled}
            onClick={() => {
              refocus.current = true;
              setStatus('loading');
              setAttempt((value) => value + 1);
            }}
          >
            {copy.retryInvoices}
          </Button>
        </div>
      )}
      {status === 'denied' && (
        <p role="status" className="text-sm text-muted-foreground">
          {copy.invoiceChoiceDenied}
        </p>
      )}
      {status === 'ready' && choices.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {copy.invoiceChoiceNone}
        </p>
      )}
      {nextCursor && status !== 'unavailable' && (
        <Button
          type="button"
          variant="link"
          className="px-0"
          disabled={disabled || status === 'loading'}
          onClick={() => setCursor(nextCursor)}
        >
          {copy.olderInvoices}
        </Button>
      )}
    </div>
  );
}
