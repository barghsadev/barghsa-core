import { useId, useRef, useState, type DragEvent } from 'react';
import { Button, cn } from '@barghsa/ui';
import { FileText, Upload, X } from 'lucide-react';
import { FilePreview } from './FilePreview.js';
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
    ? interpolate('fileRequirements', {
        formats: policy.formats.map((format) => format.extension).join(', '),
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
    const issue = validateUploadFiles(files, policy, maxFiles);
    setError(issue);
    if (!issue) {
      setPreviews([]);
      onChange(files);
    }
  }
  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    if (!blocked) choose(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      className="flex min-w-0 flex-col gap-3"
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
      <Button
        type="button"
        variant="outline"
        disabled={blocked}
        aria-describedby={`${id}-rules${problem ? ` ${id}-error` : ''}`}
        className={cn(
          'h-auto min-h-28 w-full flex-col gap-2 whitespace-normal border-dashed px-4 py-5 text-center',
          dragging && 'border-primary bg-accent'
        )}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!blocked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <Upload aria-hidden="true" className="size-6" />
        {word('dropFiles')}
      </Button>
      <p id={`${id}-rules`} className="break-words text-sm text-muted-foreground">
        {requirements}
      </p>
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
      <ul className="flex flex-col gap-2">
        {value.map((file, index) => {
          const transfer = progress?.find((item) => item.file === file);
          const percent = transfer
            ? Math.min(
                100,
                Math.max(0, Math.floor((transfer.loaded / Math.max(1, transfer.total)) * 100))
              )
            : 0;
          return (
            <li
              key={`${file.name}:${file.lastModified}:${index}`}
              className="min-w-0 space-y-2 rounded-md border p-3"
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileText aria-hidden="true" className="size-4 shrink-0" />
                <bdi className="min-w-0 flex-1 break-all text-sm">{file.name}</bdi>
                <span className="shrink-0 text-sm text-muted-foreground">{size(file.size)}</span>
                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={interpolate('removeFile', { name: file.name })}
                    onClick={() => {
                      setError(null);
                      setPreviews((current) => current.filter((item) => item !== file));
                      onChange(value.filter((_, position) => position !== index));
                      if (input.current) input.current.value = '';
                    }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
