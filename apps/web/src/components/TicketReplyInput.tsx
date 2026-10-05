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

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import { useTicketFormFeedback } from '../hooks/useTicketFormFeedback.js';
import type { TicketCoordination, TicketReplyValues } from '../lib/ticket-form.js';
type ReplyPayload = {
  body: string;
  visibility: 'public' | 'internal';
  bodyFormat: 'markdown';
  attachments: string[];
  submissionId: string;
};
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
  coordination,
  scope,
}: {
  ticketId: string;
  profileId: string | null;
  locale: Locale;
  staff: boolean;
  busy: boolean;
  body: string;
  onBodyChange: (v: string, visibility?: 'public' | 'internal') => void;
  internal: boolean;
  onInternalChange: (v: boolean) => void;
  onSubmit: (
    prepare: () => Promise<ReplyPayload>,
    fields?: (names: unknown[]) => boolean,
    onAccepted?: () => void
  ) => Promise<boolean>;
  coordination?: TicketCoordination | undefined;
  scope?: string | undefined;
}) {
  const copy = (k: string) => t('tickets.' + k, locale),
    feedback = (k: string) => tTicketForms(k, locale),
    fileKey = useFileSelectionKey(),
    branch = staff && internal ? 'internal' : 'public',
    identity = scope ?? JSON.stringify([ticketId, profileId, staff]);
  const current = useRef(identity);
  current.current = identity;
  const branchRef = useRef(branch);
  branchRef.current = branch;
  const [fileDrafts, setFileDrafts] = useState<{ public: File[]; internal: File[] }>({
      public: [],
      internal: [],
    }),
    [fileError, setFileError] = useState(false),
    [links, setLinks] = useState({ public: 'https://', internal: 'https://' }),
    [previewFile, setPreviewFile] = useState<File | null>(null);
  const files = fileDrafts[branch],
    link = links[branch];
  const setFiles = (next: File[] | ((v: File[]) => File[])) =>
      setFileDrafts((old) => ({
        ...old,
        [branch]: typeof next === 'function' ? next(old[branch]) : next,
      })),
    setLink = (v: string) => setLinks((old) => ({ ...old, [branch]: v }));
  const textarea = useRef<HTMLTextAreaElement | null>(null),
    uploadDrafts = useRef({ public: new Map<File, string>(), internal: new Map<File, string>() }),
    selection = useRef<[number, number] | null>(null),
    alive = useRef(true),
    submitting = useRef(false);
  const uploaded = uploadDrafts.current[branch];
  const attempts = useRef<{
    public: { signature: string; id: string } | null;
    internal: { signature: string; id: string } | null;
  }>({ public: null, internal: null });
  const form = useZodForm<TicketReplyValues>(
    async () => {
      const token = identity,
        visibility = branch;
      const schema = await import('../lib/contract-review-signature-form-schemas.js');
      return alive.current && current.current === token && branchRef.current === visibility
        ? schema.ticketReplySchema(feedback, isAllowedInvoiceReceiptFile)
        : schema.inactiveTicketSchema;
    },
    {
      defaultValues: { body, files: [] },
      validationUnavailableMessage: feedback('validationUnavailable'),
    }
  );
  const locked = busy || form.formState.isSubmitting || !!coordination?.isLocked();
  const feedbackScope = JSON.stringify([identity, branch]);
  const formFeedback = useTicketFormFeedback(
    form,
    feedbackScope,
    locked,
    coordination,
    { body: feedback('replyInvalid') },
    copy('error')
  );
  const denyPreview = useCallback(() => {
    setFileDrafts({ public: [], internal: [] });
    setPreviewFile(null);
    uploadDrafts.current.public.clear();
    uploadDrafts.current.internal.clear();
    attempts.current = { public: null, internal: null };
    form.reset({ body: '', files: [] });
    onBodyChange('');
    coordination?.denied();
  }, [onBodyChange, coordination]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      uploadDrafts.current.public.clear();
      uploadDrafts.current.internal.clear();
      attempts.current = { public: null, internal: null };
    };
  }, []);
  useEffect(() => {
    form.setValue('body', body);
  }, [body]);
  useEffect(() => {
    form.setValue('files', files);
  }, [files]);
  useEffect(() => {
    setPreviewFile(null);
    setFileError(false);
    form.clearErrors();
  }, [branch]);
  useLayoutEffect(() => {
    if (!selection.current || !textarea.current) return;
    textarea.current.focus();
    textarea.current.setSelectionRange(...selection.current);
    selection.current = null;
  }, [body]);
  function insert(before: string, after = '') {
    if (locked || coordination?.isLocked()) return;
    const start = textarea.current?.selectionStart ?? body.length,
      end = textarea.current?.selectionEnd ?? start,
      next = body.slice(0, start) + before + body.slice(start, end) + after + body.slice(end);
    if (next.length > 10000) return;
    selection.current = [start + before.length, end + before.length];
    onBodyChange(next);
  }
  function addFiles(next: File[]) {
    if (locked || coordination?.isLocked()) return;
    if (files.length + next.length > 5 || next.some((f) => !isAllowedInvoiceReceiptFile(f))) {
      setFileError(true);
      form.setError('files', { type: 'validate', message: feedback('filesInvalid') });
      return;
    }
    setFileError(false);
    form.clearErrors('files');
    setFiles((old) => [...old, ...next]);
  }
  async function submit() {
    const owner = branch === 'internal' ? 'reply-internal' : 'reply-public';
    if (
      submitting.current ||
      locked ||
      !alive.current ||
      (coordination && !coordination.claim(owner))
    )
      return;
    submitting.current = true;
    const rawBody = body,
      rawFiles = [...files],
      rawBranch = branch,
      token = identity;
    try {
      const submitValidated = async () => {
        if (
          !alive.current ||
          current.current !== token ||
          branchRef.current !== rawBranch ||
          (coordination && !coordination.isCurrent())
        )
          return;
        let cleared = false;
        const clearAccepted = () => {
          if (cleared || !alive.current || current.current !== token) return;
          cleared = true;
          setFileDrafts((old) => ({ ...old, [rawBranch]: [] }));
          uploadDrafts.current[rawBranch].clear();
          attempts.current[rawBranch] = null;
          onBodyChange('', rawBranch);
          if (branchRef.current === rawBranch) {
            setPreviewFile(null);
            setFileError(false);
            form.reset({ body: '', files: [] });
          }
        };
        const accepted = await onSubmit(
          async (): Promise<ReplyPayload> => {
            const keys: string[] = [],
              cache = uploadDrafts.current[rawBranch];
            for (const file of rawFiles) {
              let key = cache.get(file);
              if (!key) {
                key = (await uploadTicketReplyAttachment(file, profileId, ticketId)) ?? undefined;
                if (!key) throw new Error('Reply attachment upload failed');
                if (
                  !alive.current ||
                  current.current !== token ||
                  branchRef.current !== rawBranch ||
                  (coordination && !coordination.isCurrent())
                )
                  throw new Error('Ticket selection changed');
                cache.set(file, key);
              }
              if (
                !alive.current ||
                current.current !== token ||
                branchRef.current !== rawBranch ||
                (coordination && !coordination.isCurrent())
              )
                throw new Error('Ticket selection changed');
              keys.push(key);
            }
            const payload: Omit<ReplyPayload, 'submissionId'> = {
                body: rawBody.trim(),
                visibility: rawBranch,
                bodyFormat: 'markdown' as const,
                attachments: keys,
              },
              signature = JSON.stringify(payload);
            if (attempts.current[rawBranch]?.signature !== signature)
              attempts.current[rawBranch] = { signature, id: crypto.randomUUID() };
            return { ...payload, submissionId: attempts.current[rawBranch]!.id };
          },
          formFeedback.fields,
          clearAccepted
        );
        if (accepted) clearAccepted();
      };
      await form.handleSubmit(submitValidated, (errors) => {
        formFeedback.invalid(errors);
        coordination?.release(owner);
      })();
    } finally {
      submitting.current = false;
      coordination?.release(owner);
    }
  }
  return (
    <Form {...form}>
      <form
        ref={formFeedback.element}
        data-slot="ticket-reply-input"
        noValidate
        aria-label={copy('send')}
        className="flex min-w-0 flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!locked) void submit();
        }}
      >
        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem id="ticket-reply">
              <FormLabel>{copy('reply')}</FormLabel>
              <FormControl>
                <textarea
                  {...field}
                  ref={(node) => {
                    field.ref(node);
                    textarea.current = node;
                  }}
                  disabled={locked}
                  rows={4}
                  className="block w-full rounded-md border border-input bg-background p-3 text-foreground"
                  value={body}
                  onChange={(e) => {
                    if (coordination?.isLocked()) return;
                    field.onChange(e);
                    onBodyChange(e.target.value);
                  }}
                />
              </FormControl>
              <FormDescription>{copy('formatHelp')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
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
              disabled={locked}
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
                  disabled={locked}
                  onChange={(event) => setLink(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={locked || !/^https?:\/\/[^\s<>()[\]\\]+$/i.test(link.trim())}
                onClick={() => insert('[', `](${link.trim()})`)}
              >
                {copy('insertLink')}
              </Button>
            </div>
          </details>
        </div>

        {body.trim() && (
          <details>
            <summary className="cursor-pointer text-sm text-primary">
              {copy('previewReply')}
            </summary>
            <div className="mt-2 rounded-md border bg-card p-3">
              <TosContent content={body} language={locale} />
            </div>
          </details>
        )}
        <FormField
          control={form.control}
          name="files"
          render={({ field }) => (
            <FormItem id="ticket-reply-files">
              <div
                className="rounded-md border border-dashed p-3"
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!locked && !coordination?.isLocked())
                    addFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <FormLabel className="mb-2 flex items-center gap-2">
                  <Paperclip aria-hidden="true" className="size-4" />
                  {copy('replyFiles')}
                </FormLabel>
                <FormControl>
                  <input
                    ref={field.ref}
                    onBlur={field.onBlur}
                    name={field.name}
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    disabled={locked}
                    className="block w-full text-sm"
                    onChange={(event) => {
                      addFiles(Array.from(event.target.files ?? []));
                      event.target.value = '';
                    }}
                  />
                </FormControl>
                <FormDescription>{copy('fileHelp')}</FormDescription>
                <FormMessage />
                <DynamicFieldArray
                  emptyFocusRef={textarea}
                  className={files.length ? 'mt-2' : 'hidden'}
                  value={files}
                  getItemKey={fileKey}
                  disabled={locked}
                  maxItems={5}
                  removeLabel={(file) => `${copy('removeFile')} ${file.name}`}
                  moveUpLabel={(file) =>
                    documentText('moveFileUp', locale).replace('{name}', file.name)
                  }
                  moveDownLabel={(file) =>
                    documentText('moveFileDown', locale).replace('{name}', file.name)
                  }
                  onChange={(next) => {
                    if (locked || coordination?.isLocked()) return;
                    for (const file of files) if (!next.includes(file)) uploaded.delete(file);
                    if (previewFile && !next.includes(previewFile)) setPreviewFile(null);
                    setFileError(false);
                    form.clearErrors('files');
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
                        disabled={locked}
                        onClick={() => {
                          if (!coordination?.isLocked())
                            setPreviewFile((current) => (current === file ? null : file));
                        }}
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
            </FormItem>
          )}
        />
        {fileError && (
          <p role="alert" className="text-sm text-destructive">
            {copy('invalidReplyFiles')}
          </p>
        )}
        {staff && (
          <Label className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled={locked}
              checked={internal}
              onChange={(e) => {
                if (!coordination?.isLocked()) onInternalChange(e.target.checked);
              }}
            />
            {copy('internal')}
          </Label>
        )}
        {form.formState.errors.root && <p role="alert">{feedback('validationUnavailable')}</p>}
        <Button className="self-start" disabled={locked} type="submit">
          {locked && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          )}
          {copy(locked ? 'saving' : 'send')}
        </Button>
      </form>
    </Form>
  );
}
