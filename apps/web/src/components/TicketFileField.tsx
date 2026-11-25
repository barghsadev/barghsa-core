import { useRef, type RefObject } from 'react';
import { Paperclip } from 'lucide-react';
import { Button, DynamicFieldArray } from '@barghsa/ui';
import { FormControl, FormDescription, FormLabel, FormMessage } from '@barghsa/ui/form';
import { t, type Locale } from '@barghsa/i18n/app';
import { documentText } from '@barghsa/i18n/documents';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import { useFileSelectionKey } from '../hooks/useFileSelectionKey.js';
import { isAllowedInvoiceReceiptFile } from '../lib/invoice-bank-receipt-fields.js';
import { FilePreview } from './FilePreview.js';

export function TicketFileField({
  locale,
  input,
  files,
  preview,
  disabled,
  isLocked,
  emptyFocusRef,
  onChange,
  onInvalid,
  onPreview,
  onAccessDenied,
}: {
  locale: Locale;
  input: { name: string; ref: (node: HTMLInputElement | null) => void; onBlur: () => void };
  files: File[];
  preview: File | null;
  disabled: boolean;
  isLocked: () => boolean;
  emptyFocusRef?: RefObject<HTMLElement | null>;
  onChange: (files: File[]) => void;
  onInvalid: () => void;
  onPreview: (file: File | null) => void;
  onAccessDenied: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileKey = useFileSelectionKey();
  const label = tTicketForms('attachFiles', locale);
  const previewLabel = documentText('preview', locale);

  function addFiles(selection: File[]) {
    if (disabled || isLocked()) return;
    const additions = [...new Set(selection)].filter((file) => !files.includes(file));
    if (!additions.length) return;
    if (
      files.length + additions.length > 5 ||
      additions.some((file) => !isAllowedInvoiceReceiptFile(file))
    ) {
      onInvalid();
      return;
    }
    onChange([...files, ...additions]);
  }

  return (
    <div
      className="min-w-0 space-y-2 rounded-lg border border-dashed p-2.5"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="relative inline-flex min-h-11 max-w-full items-center rounded-lg border border-border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-ring hover:bg-muted/50 has-[:disabled]:opacity-60">
        <FormLabel className="flex min-w-0 items-center gap-2">
          <Paperclip aria-hidden="true" className="size-4 shrink-0" />
          {label}
        </FormLabel>
        <FormControl>
          <input
            type="file"
            ref={(node) => {
              inputRef.current = node;
              input.ref(node);
            }}
            name={input.name}
            onBlur={input.onBlur}
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            multiple
            disabled={disabled}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </FormControl>
      </div>
      <FormDescription>
        {documentText('dropFiles', locale)}. {t('tickets.fileHelp', locale)}
      </FormDescription>
      <FormMessage />
      <DynamicFieldArray
        value={files}
        emptyFocusRef={emptyFocusRef ?? inputRef}
        className={
          files.length
            ? 'mt-2 [&_[role=list]]:gap-2 [&_button[data-array-action]]:size-9 [&_button[data-array-action]]:border-border'
            : 'hidden'
        }
        getItemKey={fileKey}
        disabled={disabled}
        maxItems={5}
        removeLabel={(file) => `${t('tickets.removeFile', locale)} ${file.name}`}
        moveUpLabel={(file) => documentText('moveFileUp', locale).replace('{name}', file.name)}
        moveDownLabel={(file) => documentText('moveFileDown', locale).replace('{name}', file.name)}
        onChange={(next) => {
          if (!disabled && !isLocked()) onChange(next);
        }}
        renderItem={(file, _index, actions) => (
          <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-card px-2.5 py-2">
            <bdi className="min-w-0 basis-full break-words text-sm sm:flex-1 sm:basis-auto">
              {file.name}
            </bdi>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${previewLabel}: ${file.name}`}
              aria-expanded={preview === file}
              disabled={disabled}
              onClick={() => {
                if (!isLocked()) onPreview(preview === file ? null : file);
              }}
            >
              {preview === file ? documentText('hidePreview', locale) : previewLabel}
            </Button>
            {actions}
          </div>
        )}
      />
      {preview && files.includes(preview) && (
        <FilePreview
          file={preview}
          name={preview.name}
          locale={locale}
          onAccessDenied={onAccessDenied}
        />
      )}
    </div>
  );
}
