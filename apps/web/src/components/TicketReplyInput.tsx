import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Italic, List, Link as LinkIcon, Paperclip } from 'lucide-react';
import { Button, DynamicFieldArray, Input, Label } from '@barghsa/ui';
import { useFileSelectionKey } from '../hooks/useFileSelectionKey.js';
import { t, type Locale } from '@barghsa/i18n/app';
import TosContent from './TosContent.js';
import { FilePreview } from './FilePreview.js';
import { documentText } from '@barghsa/i18n/documents';
import {
  isAllowedInvoiceReceiptFile,
  uploadTicketReplyAttachment,
} from '../lib/invoice-bank-receipt-upload.js';

interface ReplyPayload {
  body: string;
  visibility: 'public' | 'internal';
  bodyFormat: 'markdown';
  attachments: string[];
  submissionId: string;
}

export function TicketReplyInput({
  ticketId,
  profileId,
  locale,
  staff,
  busy,
  body,
  onBodyChange,
  internal,
  onInternalChange,
  onSubmit,
}: {
  ticketId: string;
  profileId: string | null;
  locale: Locale;
  staff: boolean;
  busy: boolean;
  body: string;
  onBodyChange: (value: string) => void;
  internal: boolean;
  onInternalChange: (value: boolean) => void;
  onSubmit: (prepare: () => Promise<ReplyPayload>) => Promise<boolean>;
}) {
  const copy = (key: string) => t(`tickets.${key}`, locale);
  const fileKey = useFileSelectionKey();
  const [files, setFiles] = useState<File[]>([]),
    [fileError, setFileError] = useState(false),
    [link, setLink] = useState('https://');
  const textarea = useRef<HTMLTextAreaElement>(null),
    uploaded = useRef(new Map<File, string>());
  const selection = useRef<[number, number] | null>(null),
    alive = useRef(true);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const denyPreview = useCallback(() => {
    setFiles([]);
    setPreviewFile(null);
    uploaded.current.clear();
    attempt.current = null;
    onBodyChange('');
  }, [onBodyChange]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (!selection.current || !textarea.current) return;
    textarea.current.focus();
    textarea.current.setSelectionRange(...selection.current);
    selection.current = null;
  }, [body]);
  function insert(before: string, after = '') {
    const start = textarea.current?.selectionStart ?? body.length,
      end = textarea.current?.selectionEnd ?? start;
    const next = body.slice(0, start) + before + body.slice(start, end) + after + body.slice(end);
    if (next.length > 10000) return;
    selection.current = [start + before.length, end + before.length];
    onBodyChange(next);
  }
  function addFiles(next: File[]) {
    if (busy) return;
    if (files.length + next.length > 5 || next.some((file) => !isAllowedInvoiceReceiptFile(file))) {
      setFileError(true);
      return;
    }
    setFileError(false);
    setFiles((current) => [...current, ...next]);
  }
  async function submit() {
    const accepted = await onSubmit(async () => {
      const keys: string[] = [];
      for (const file of files) {
        let key = uploaded.current.get(file);
        if (!key) {
          key = (await uploadTicketReplyAttachment(file, profileId, ticketId)) ?? undefined;
          if (!key) throw new Error('Reply attachment upload failed');
          uploaded.current.set(file, key);
        }
        if (!alive.current) throw new Error('Ticket selection changed');
        keys.push(key);
      }
      const payload = {
        body: body.trim(),
        visibility: staff && internal ? ('internal' as const) : ('public' as const),
        bodyFormat: 'markdown' as const,
        attachments: keys,
      };
      const signature = JSON.stringify(payload);
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, id: crypto.randomUUID() };
      return { ...payload, submissionId: attempt.current.id };
    });
    if (accepted && alive.current) {
      setFiles([]);
      setPreviewFile(null);
      setFileError(false);
      uploaded.current.clear();
      attempt.current = null;
    }
  }
  return (
    <form
      data-slot="ticket-reply-input"
      className="flex min-w-0 flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && (body.trim() || files.length)) void submit();
      }}
    >
      <Label htmlFor="ticket-reply">{copy('reply')}</Label>
      <div
        role="group"
        aria-label={copy('formatting')}
        className="flex flex-wrap items-center gap-1"
      >
        {(
          [
            ['bold', Bold, () => insert('**', '**')],
            ['italic', Italic, () => insert('_', '_')],
            [
              'bulletList',
              List,
              () => {
                const start = textarea.current?.selectionStart ?? body.length,
                  end = textarea.current?.selectionEnd ?? start;
                const selected = body.slice(start, end);
                const before = start && body[start - 1] !== '\n' ? '\n' : '';
                const formatted = before + '- ' + selected.replaceAll('\n', '\n- ');
                const next = body.slice(0, start) + formatted + body.slice(end);
                if (next.length <= 10000) {
                  selection.current = [start + before.length + 2, start + formatted.length];
                  onBodyChange(next);
                }
              },
            ],
          ] as const
        ).map(([key, Icon, action]) => (
          <Button
            key={key}
            type="button"
            variant="outline"
            size="icon"
            disabled={busy}
            aria-label={copy(key)}
            title={copy(key)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={action}
          >
            <Icon aria-hidden="true" />
          </Button>
        ))}
        <details className="min-w-0">
          <summary className="cursor-pointer rounded-md border px-3 py-2 text-sm">
            <LinkIcon aria-hidden="true" className="inline size-4" /> {copy('insertLink')}
          </summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor="ticket-reply-link">{copy('linkAddress')}</Label>
              <Input
                id="ticket-reply-link"
                dir="ltr"
                value={link}
                disabled={busy}
                onChange={(event) => setLink(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !/^https?:\/\/[^\s<>()[\]\\]+$/i.test(link.trim())}
              onClick={() => insert('[', `](${link.trim()})`)}
            >
              {copy('insertLink')}
            </Button>
          </div>
        </details>
      </div>
      <textarea
        ref={textarea}
        id="ticket-reply"
        disabled={busy}
        required={!files.length}
        rows={4}
        maxLength={10000}
        aria-describedby="ticket-reply-format-help"
        className="block w-full rounded-md border border-input bg-background p-3 text-foreground"
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
      />
      <p id="ticket-reply-format-help" className="text-xs text-muted-foreground">
        {copy('formatHelp')}
      </p>
      {body.trim() && (
        <details>
          <summary className="cursor-pointer text-sm text-primary">{copy('previewReply')}</summary>
          <div className="mt-2 rounded-md border bg-card p-3">
            <TosContent content={body} language={locale} />
          </div>
        </details>
      )}
      <div
        className="rounded-md border border-dashed p-3"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!busy) addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <Label htmlFor="ticket-reply-files" className="mb-2 flex items-center gap-2">
          <Paperclip aria-hidden="true" className="size-4" />
          {copy('replyFiles')}
        </Label>
        <input
          id="ticket-reply-files"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          disabled={busy}
          aria-describedby="ticket-reply-files-help"
          className="block w-full text-sm"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <p id="ticket-reply-files-help" className="mt-2 text-xs text-muted-foreground">
          {copy('fileHelp')}
        </p>
        <DynamicFieldArray
          emptyFocusRef={textarea}
          className={files.length ? 'mt-2' : 'hidden'}
          value={files}
          getItemKey={fileKey}
          disabled={busy}
          maxItems={5}
          removeLabel={(file) => `${copy('removeFile')} ${file.name}`}
          moveUpLabel={(file) => documentText('moveFileUp', locale).replace('{name}', file.name)}
          moveDownLabel={(file) =>
            documentText('moveFileDown', locale).replace('{name}', file.name)
          }
          onChange={(next) => {
            for (const file of files) if (!next.includes(file)) uploaded.current.delete(file);
            if (previewFile && !next.includes(previewFile)) setPreviewFile(null);
            setFileError(false);
            setFiles(next);
          }}
          renderItem={(file, _index, actions) => (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 basis-full break-words sm:flex-1 sm:basis-auto">
                <bdi>{file.name}</bdi>
              </span>
              <Button
                type="button"
                variant="ghost"
                aria-label={`${documentText('preview', locale)}: ${file.name}`}
                aria-expanded={previewFile === file}
                onClick={() => setPreviewFile((current) => (current === file ? null : file))}
              >
                {documentText(previewFile === file ? 'hidePreview' : 'preview', locale)}
              </Button>
              {actions}
            </div>
          )}
        />
        {previewFile && files.includes(previewFile) && (
          <FilePreview
            file={previewFile}
            name={previewFile.name}
            locale={locale}
            onAccessDenied={denyPreview}
          />
        )}
      </div>
      {fileError && (
        <p role="alert" className="text-sm text-destructive">
          {copy('invalidReplyFiles')}
        </p>
      )}
      {staff && (
        <Label className="flex items-center gap-2">
          <input
            type="checkbox"
            disabled={busy}
            checked={internal}
            onChange={(event) => onInternalChange(event.target.checked)}
          />
          {copy('internal')}
        </Label>
      )}
      <Button
        className="self-start"
        disabled={busy || (!body.trim() && !files.length)}
        type="submit"
      >
        {copy(busy ? 'saving' : 'send')}
      </Button>
    </form>
  );
}
