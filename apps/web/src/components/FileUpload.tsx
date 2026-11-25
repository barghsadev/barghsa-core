import { useId, useRef, useState, type DragEvent } from 'react';
import { Button, DynamicFieldArray, cn } from '@barghsa/ui';
import { FileText, Upload } from 'lucide-react';
import { useFileSelectionKey } from '../hooks/useFileSelectionKey.js';
import { FilePreview } from './FilePreview.js';
import {
  recordFilePicker,
  recordFilePickerAction,
  recordFilePickerHelp,
} from './RecordEditorLayout.js';
import { documentText } from '@barghsa/i18n/documents';
import type { Locale } from '@barghsa/i18n/app';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  validateUploadFiles,
  uploadContentType,
  type FileUploadPolicy,
  type FileValidationError,
} from '../lib/file-upload.js';

export type FileUploadProgress = {
  loaded: number;
  total: number;
  phase: 'uploading' | 'confirming' | 'failed' | 'paused';
};
export function FileUpload({
  value,
  onChange,
  policy,
  locale,
  maxFiles = 1,
  disabled = false,
  progress,
  onAccessDenied,
}: {
  value: readonly File[];
  onChange: (files: File[]) => void;
  policy: FileUploadPolicy | null;
  locale: Locale;
  maxFiles?: number;
  disabled?: boolean;
  progress?: readonly (FileUploadProgress & { file: File })[];
  onAccessDenied?: (() => void) | undefined;
}) {
  const word = (key: string) => documentText(key, locale),
    numbers = useNumberFormatting(locale);
  const id = useId(),
    input = useRef<HTMLInputElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const fileKey = useFileSelectionKey();
  const [error, setError] = useState<FileValidationError | null>(null),
    [dragging, setDragging] = useState(false);
  const [previews, setPreviews] = useState<readonly File[]>([]);
  const blocked = disabled || !policy || !policy.formats.length;
  const interpolate = (key: string, values: Record<string, string>) =>
    word(key).replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => values[name] ?? whole);
  function size(bytes: number) {
    return bytes >= 1048576
      ? `${numbers.number(bytes / 1048576, { maximumFractionDigits: 1 })} ${word('sizeMb')}`
      : bytes >= 1024
        ? `${numbers.number(bytes / 1024, { maximumFractionDigits: 1 })} ${word('sizeKb')}`
        : `${numbers.number(bytes)} ${word('sizeBytes')}`;
  }
  const requirements = policy
    ? interpolate(maxFiles === 1 ? 'singleFileRequirements' : 'fileRequirements', {
        formats: `\u2066${policy.formats.map((format) => format.extension).join(', ')}\u2069`,
        size: size(policy.maxSizeBytes),
        count: numbers.number(maxFiles),
      })
    : word('policyLoading');
  const issue = error ?? (policy ? validateUploadFiles(value, policy, maxFiles) : null);
  const problem = issue
    ? interpolate(`fileError${issue.code[0]!.toUpperCase()}${issue.code.slice(1)}`, {
        name: issue.file?.name ?? '',
        count: numbers.number(maxFiles),
        size: policy ? size(policy.maxSizeBytes) : '',
        type: issue.file
          ? issue.file.name.lastIndexOf('.') >= 0
            ? issue.file.name.slice(issue.file.name.lastIndexOf('.')).toLowerCase()
            : issue.file.type || issue.file.name
          : '',
      })
    : null;
  function choose(files: File[]) {
    if (blocked || !policy) return;
    const next = maxFiles > 1 ? [...new Set([...value, ...files])] : files;
    const issue = validateUploadFiles(next, policy, maxFiles);
    setError(issue);
    if (!issue) {
      setPreviews((current) => current.filter((file) => next.includes(file)));
      onChange(next);
    }
  }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!blocked) choose(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-2.5"
      data-slot="file-upload"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <input
        ref={input}
        id={id}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label={word('file')}
        multiple={maxFiles > 1}
        accept={policy?.formats.map((format) => format.extension).join(',')}
        disabled={blocked}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) choose(files);
        }}
      />
      <div
        className={cn(
          recordFilePicker,
          progress && 'hidden',
          dragging && 'border-primary bg-accent'
        )}
        onDragOver={(event) => {
          event.preventDefault();
          if (!blocked) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          )
            setDragging(false);
        }}
        onDrop={drop}
      >
        <Button
          ref={browse}
          type="button"
          variant="outline"
          disabled={blocked}
          aria-describedby={`${id}-rules${problem ? ` ${id}-error` : ''}`}
          className={recordFilePickerAction}
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden="true" className="size-4 shrink-0" />
          {word(maxFiles > 1 ? 'chooseFiles' : value.length ? 'changeSelectedFile' : 'chooseFile')}
        </Button>
        <div className={recordFilePickerHelp}>
          {!blocked && <p className="hidden [@media(pointer:fine)]:block">{word('dropHere')}</p>}
          <p id={`${id}-rules`}>{requirements}</p>
        </div>
      </div>
      {problem && (
        <p id={`${id}-error`} role="alert" className="break-words text-sm text-destructive">
          {problem}
        </p>
      )}
      {policy && !policy.formats.length && (
        <p role="alert" className="text-sm text-destructive">
          {word('noFileFormats')}
        </p>
      )}
      <DynamicFieldArray
        className={value.length ? '' : 'hidden'}
        emptyFocusRef={browse}
        value={value}
        getItemKey={fileKey}
        disabled={disabled}
        reorder={maxFiles > 1}
        maxItems={maxFiles}
        removeLabel={(file) => interpolate('removeFile', { name: file.name })}
        moveUpLabel={(file) => interpolate('moveFileUp', { name: file.name })}
        moveDownLabel={(file) => interpolate('moveFileDown', { name: file.name })}
        onChange={(files) => {
          setError(null);
          setPreviews((current) => current.filter((file) => files.includes(file)));
          onChange(files);
          if (input.current) input.current.value = '';
        }}
        renderItem={(file, _index, actions) => {
          const transfer = progress?.find((item) => item.file === file);
          const percent = transfer
            ? Math.min(
                100,
                Math.max(0, Math.floor((transfer.loaded / Math.max(1, transfer.total)) * 100))
              )
            : 0;
          return (
            <div className="min-w-0 space-y-2 rounded-lg border px-3 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <FileText aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium [overflow-wrap:anywhere]">
                      <bdi>{file.name}</bdi>
                    </p>
                    <p className="text-xs text-muted-foreground">{size(file.size)}</p>
                  </div>
                </div>
                {!disabled && actions}
                <Button
                  type="button"
                  variant="ghost"
                  className="text-primary"
                  aria-label={`${word('preview')}: ${file.name}`}
                  aria-expanded={previews.includes(file)}
                  onClick={() =>
                    setPreviews((current) =>
                      current.includes(file)
                        ? current.filter((item) => item !== file)
                        : [...current, file]
                    )
                  }
                >
                  {word(previews.includes(file) ? 'hidePreview' : 'preview')}
                </Button>
              </div>
              {previews.includes(file) && (
                <FilePreview
                  file={file}
                  name={file.name}
                  locale={locale}
                  contentType={(policy && uploadContentType(file, policy)) || file.type}
                  onAccessDenied={onAccessDenied}
                />
              )}
              {transfer && (
                <>
                  <div
                    role="progressbar"
                    aria-label={interpolate('fileProgress', { name: file.name })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-valuetext={
                      transfer.phase === 'confirming'
                        ? word('confirming')
                        : `${numbers.number(percent)}%`
                    }
                    className="h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full bg-primary motion-safe:transition-[width]"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="text-sm text-muted-foreground"
                  >
                    {word(transfer.phase)} · {numbers.number(percent)}% · {size(transfer.loaded)} /{' '}
                    {size(transfer.total)}
                  </p>
                </>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
