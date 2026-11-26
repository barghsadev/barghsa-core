import { useCallback, type RefObject } from 'react';
import { DatePicker, Input, Label, Textarea, cn, datePickerCalendarDate } from '@barghsa/ui';
import { FormField } from '@barghsa/ui/form';
import { t } from '@barghsa/i18n/workspace';
import { receiptUploadMessages } from '@barghsa/i18n/receipt-editor';
import { formatToman } from '@barghsa/i18n/numbers';
import {
  INVOICE_BANK_RECEIPT_FILE_ACCEPT,
  parseBankReceiptTopUpAmountIrR,
} from '@barghsa/shared/finance/browser';
import { ChevronDown, FileCheck, Paperclip } from 'lucide-react';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { useReceiptForm } from '../hooks/useReceiptForm.js';
import type { ReceiptFormValues } from '../lib/customer-finance-form-schemas.js';
import { normalizeIrrAmountDigits } from '../lib/invoice-bank-receipt-fields.js';

type ReceiptField = keyof ReceiptFormValues;

export function CustomerReceiptFields({
  kind,
  draft,
  disabled,
  maxDate,
  fileInput,
  onEdit,
}: {
  kind: 'wallet' | 'invoice';
  draft: ReturnType<typeof useReceiptForm>;
  disabled: boolean;
  maxDate: string;
  fileInput: RefObject<HTMLInputElement | null>;
  onEdit: (name: ReceiptField) => void;
}) {
  const locale = useLocale();
  const { numberStyle } = useNumberFormatting(locale);
  const copy = receiptUploadMessages[locale];
  const prefix = kind === 'wallet' ? 'wallet.page' : 'invoices.details';
  const label = (key: string) => t(`${prefix}.${key}`, locale);
  const id = kind === 'wallet' ? 'receipt' : 'invoice-receipt';
  const testId = `${kind}-receipt`;
  const file = draft.values.file;
  const AttachmentIcon = file ? FileCheck : Paperclip;
  const amountIrR = parseBankReceiptTopUpAmountIrR(normalizeIrrAmountDigits(draft.values.amount));
  const amountHelp =
    amountIrR === null
      ? copy.amountHelp
      : copy.tomanEquivalent.replace('{amount}', formatToman(amountIrR, locale, { numberStyle }));
  const { register } = draft.form;
  const noteRef = useCallback(
    (element: HTMLTextAreaElement | null) =>
      register('customerNote').ref(
        element
          ? {
              focus: () => {
                const disclosure = element.closest('details');
                if (disclosure) disclosure.open = true;
                element.focus();
              },
            }
          : null
      ),
    [register]
  );

  function feedback(name: ReceiptField) {
    const error = draft.errors[name];
    return error ? (
      <p id={draft.errorId(name)} role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    ) : null;
  }

  function textInput(
    name: Exclude<ReceiptField, 'file' | 'customerNote'>,
    suffix: string,
    inputLabel: string
  ) {
    const fieldId = `${id}-${suffix}`;
    const [value, setValue] = draft.field(name);
    const amount = name === 'amount';
    const date = name === 'paymentDate';
    const help = amount ? amountHelp : name === 'payerReference' ? copy.bankReferenceHelp : null;
    const { onBlur, ...binding } = draft.bind(name);
    return (
      <div className="min-w-0 space-y-1">
        <Label htmlFor={fieldId}>{inputLabel}</Label>
        {date && locale === 'fa' ? (
          <DatePicker
            id={fieldId}
            label={inputLabel}
            locale={locale}
            // Receipts use a date-only value and the existing UTC day limit.
            timezone="UTC"
            value={datePickerCalendarDate(value, 'UTC')}
            maxDate={datePickerCalendarDate(maxDate, 'UTC')}
            showYearSelect
            compactLabel
            disabled={disabled}
            className="min-h-11"
            triggerProps={{ ...binding, 'aria-required': true }}
            onBlur={onBlur}
            onChange={(selected) => {
              setValue(
                selected
                  ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`
                  : ''
              );
              onEdit(name);
            }}
          />
        ) : (
          <Input
            {...binding}
            onBlur={onBlur}
            id={fieldId}
            data-testid={`${testId}-${suffix}`}
            type={date ? 'date' : 'text'}
            inputMode={amount ? 'numeric' : undefined}
            dir={amount ? 'ltr' : undefined}
            autoComplete={date ? undefined : 'off'}
            max={date ? maxDate : undefined}
            maxLength={!date && !amount ? 128 : undefined}
            aria-required={name !== 'bankName' || undefined}
            aria-describedby={
              [help ? `${fieldId}-hint` : null, binding['aria-describedby']]
                .filter(Boolean)
                .join(' ') || undefined
            }
            value={value}
            disabled={disabled}
            onChange={(event) => {
              setValue(amount ? normalizeIrrAmountDigits(event.target.value) : event.target.value);
              onEdit(name);
            }}
          />
        )}
        {feedback(name)}
        {help && (
          <p
            id={`${fieldId}-hint`}
            data-testid={amount && amountIrR !== null ? `${testId}-toman` : undefined}
            className={cn(
              'text-xs text-muted-foreground',
              amount && amountIrR !== null && 'font-medium text-foreground'
            )}
          >
            <bdi>{help}</bdi>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-2">
      {textInput('amount', 'amount', label('receiptAmountLabel'))}
      {textInput('paymentDate', 'date', label('receiptDateLabel'))}
      {textInput('payerReference', 'payer-ref', copy.bankReference)}
      {textInput('bankName', 'bank-name', t('invoices.details.receiptBankNameLabel', locale))}
      <div className="min-w-0 space-y-1 sm:col-span-2">
        <Label htmlFor={`${id}-file`}>{label('receiptFileLabel')}</Label>
        <FormField
          control={draft.form.control}
          name="file"
          render={({ field }) => (
            <div
              className={cn(
                'relative flex min-h-11 items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-foreground focus-within:ring-offset-2',
                disabled ? 'bg-muted/45 opacity-70' : 'bg-muted/25 hover:bg-muted/55',
                draft.errors.file && 'border-destructive'
              )}
            >
              <AttachmentIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span aria-hidden="true" className="min-w-0 flex-1 truncate" title={file?.name}>
                {file ? <bdi>{file.name}</bdi> : t('invoices.details.receiptChooseFile', locale)}
              </span>
              {file && (
                <span aria-hidden="true" className="shrink-0 text-xs font-medium text-primary">
                  {t('invoices.details.receiptChangeFile', locale)}
                </span>
              )}
              <input
                ref={(element) => {
                  field.ref(element);
                  fileInput.current = element;
                }}
                onBlur={field.onBlur}
                aria-required="true"
                aria-invalid={!!draft.errors.file || undefined}
                aria-describedby={[
                  `${id}-file-hint`,
                  draft.errors.file ? draft.errorId('file') : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
                id={`${id}-file`}
                data-testid={`${testId}-file`}
                name="receiptFile"
                type="file"
                accept={INVOICE_BANK_RECEIPT_FILE_ACCEPT}
                disabled={disabled}
                onChange={(event) => {
                  draft.field('file')[1](event.target.files?.[0] ?? null);
                  onEdit('file');
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
            </div>
          )}
        />
        <p id={`${id}-file-hint`} className="text-xs text-muted-foreground">
          {label('receiptFileHint')}
        </p>
        {feedback('file')}
      </div>
      <div className="min-w-0 space-y-1 sm:col-span-2">
        <details className="group min-w-0 rounded-lg border bg-muted/20">
          <summary
            aria-labelledby={`${id}-note-label`}
            aria-describedby={draft.errors.customerNote ? draft.errorId('customerNote') : undefined}
            className="flex min-h-11 min-w-0 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
          >
            <span className="min-w-0">
              <span id={`${id}-note-label`} className="block font-medium text-primary">
                {label('receiptNoteLabel')}
              </span>
              {draft.values.customerNote.trim() && (
                <bdi className="mt-0.5 line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere] group-open:hidden">
                  {draft.values.customerNote}
                </bdi>
              )}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-primary transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="min-w-0 space-y-1 px-3 pb-2">
            <Label htmlFor={`${id}-note`} className="sr-only">
              {label('receiptNoteLabel')}
            </Label>
            <Textarea
              {...draft.bind('customerNote')}
              ref={noteRef}
              id={`${id}-note`}
              data-testid={`${testId}-note`}
              rows={2}
              dir="auto"
              maxLength={2000}
              value={draft.values.customerNote}
              disabled={disabled}
              className="min-h-14"
              aria-describedby={[
                `${id}-note-hint`,
                draft.errors.customerNote ? draft.errorId('customerNote') : null,
              ]
                .filter(Boolean)
                .join(' ')}
              onChange={(event) => {
                draft.field('customerNote')[1](event.target.value);
                onEdit('customerNote');
              }}
            />
            <p id={`${id}-note-hint`} className="text-xs text-muted-foreground">
              {t('invoices.details.receiptNoteHint', locale)}
            </p>
          </div>
        </details>
        {feedback('customerNote')}
      </div>
    </div>
  );
}
