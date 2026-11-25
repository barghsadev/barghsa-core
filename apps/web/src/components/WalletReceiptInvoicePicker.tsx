import { useEffect, useId, useState } from 'react';
import { Button, Label, NativeSelect } from '@barghsa/ui';
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
import { recordEditorField } from './RecordEditorLayout.js';

interface InvoiceChoice {
  invoiceId: string;
  profileId: string;
  state: string;
  totalAmount: string;
  paidAmount: string;
  createdAt: string;
}

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
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'ready'>('loading');

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
      .catch(() => {
        if (controller.signal.aborted) return;
        setChoices([]);
        setNextCursor(null);
        setStatus('unavailable');
      });
    return () => controller.abort();
  }, [profileId, read, cursor]);

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
      <NativeSelect
        {...field}
        id={id}
        className="w-full"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
      >
        <option value="">{copy.walletCredit}</option>
        {value && !choices.some((invoice) => invoice.invoiceId === value) && (
          <option value={value}>…{value.trim().slice(-12)}</option>
        )}
        {choices.map((invoice) => {
          const remaining = remainingForBankReceiptSettlement({
            state: invoice.state,
            totalAmount: BigInt(invoice.totalAmount),
            paidAmount: BigInt(invoice.paidAmount),
          });
          return (
            <option
              key={invoice.invoiceId}
              value={invoice.invoiceId}
            >{`…${invoice.invoiceId.slice(-12)} · ${format(invoice.createdAt, { dateStyle: 'short' })} · ${t(`invoices.state.${invoice.state}`, locale)} · ${money(remaining)}`}</option>
          );
        })}
      </NativeSelect>
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
        <p role="status" className="text-sm text-muted-foreground">
          {copy.invoiceChoiceError}
        </p>
      )}
      {status === 'ready' && choices.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {copy.invoiceChoiceNone}
        </p>
      )}
      {nextCursor && (
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
