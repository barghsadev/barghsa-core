import { useRef, type RefObject } from 'react';
import { Button, cn } from '@barghsa/ui';
import { FileText, Paperclip, X } from 'lucide-react';
import { tCrmForm } from '@barghsa/i18n/crm-forms';
import type { Locale } from '@barghsa/i18n/app';
import { isAllowedInvoiceReceiptFile } from '../lib/invoice-bank-receipt-fields.js';
import {
  recordFilePicker,
  recordFilePickerAction,
  recordFilePickerHelp,
} from './RecordEditorLayout.js';

export function VerificationEvidencePicker({
  id,
  pickerId = id + '-picker',
  locale,
  inputRef,
  accept,
  instructions,
  chooseLabel,
  emptyLabel,
  files,
  error,
  onChange,
}: {
  id: string;
  pickerId?: string;
  locale: Locale;
  inputRef: RefObject<HTMLInputElement | null>;
  accept: string;
  instructions: string;
  chooseLabel: string;
  emptyLabel: string;
  files: readonly File[];
  error?: string | undefined;
  onChange: (files: File[]) => void;
}) {
  const picker = useRef<HTMLButtonElement>(null);
  const text = (key: string) => tCrmForm('crm.evidence.' + key, locale);
  return (
    <div className="min-w-0 space-y-2">
      <input
        ref={inputRef}
        hidden
        id={id}
        type="file"
        aria-labelledby={id + '-rules'}
        aria-required="true"
        multiple
        accept={accept}
        onChange={(event) => onChange(Array.from(event.target.files ?? []))}
      />
      <div className={recordFilePicker}>
        <Button
          id={pickerId}
          ref={picker}
          type="button"
          variant="outline"
          className={recordFilePickerAction}
          aria-invalid={!!error || undefined}
          aria-describedby={[id + '-rules', id + '-selected', error && id + '-error']
            .filter(Boolean)
            .join(' ')}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="size-4 shrink-0" aria-hidden="true" />
          {files.length ? text('changeFiles') : chooseLabel}
        </Button>
        <p id={id + '-rules'} className={recordFilePickerHelp}>
          {instructions}
        </p>
      </div>
      <p id={id + '-selected'} className="sr-only" aria-live="polite">
        {files.length ? files.map((file) => file.name).join(' · ') : emptyLabel}
      </p>
      {error && (
        <p id={id + '-error'} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!!files.length && (
        <ul aria-label={text('selectedFiles')} className="divide-y rounded-lg border bg-card">
          {files.map((file, index) => {
            const invalid = !isAllowedInvoiceReceiptFile(file);
            const remove = text('removeFile').replace('{name}', file.name);
            return (
              <li key={index} className="flex min-w-0 items-center gap-2 px-3 py-1.5">
                <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                  <bdi>{file.name}</bdi>
                  {invalid && <p className="text-xs text-destructive">{text('checkFile')}</p>}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn('touch-action size-9 shrink-0', invalid && 'text-destructive')}
                  aria-label={remove}
                  title={remove}
                  onClick={() => {
                    if (inputRef.current) inputRef.current.value = '';
                    onChange(files.filter((_, fileIndex) => index !== fileIndex));
                    picker.current?.focus();
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
