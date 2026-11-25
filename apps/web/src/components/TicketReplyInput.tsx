import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Italic, List, Link as LinkIcon } from 'lucide-react';
import { Button, Input, Label, Textarea } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/app';
import TosContent from './TosContent.js';
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
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
import { TicketFileField } from './TicketFileField.js';
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
    branch = staff && internal ? 'internal' : 'public',
    sendLabel = branch === 'internal' ? feedback('saveInternalNote') : copy('send'),
    identity = scope ?? JSON.stringify([ticketId, profileId, staff]);
  const current = useRef(identity);
  current.current = identity;
  const branchRef = useRef(branch);
  branchRef.current = branch;
  const [fileDrafts, setFileDrafts] = useState<{ public: File[]; internal: File[] }>({
      public: [],
      internal: [],
    }),
    [links, setLinks] = useState({ public: 'https://', internal: 'https://' }),
    [previewFile, setPreviewFile] = useState<File | null>(null);
  const files = fileDrafts[branch],
    link = links[branch];
  const setFiles = (next: File[]) => setFileDrafts((old) => ({ ...old, [branch]: next })),
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
      const schema = await import('../lib/ticket-form-schemas.js');
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
        aria-label={sendLabel}
        className={recordEditorSurface}
        onSubmit={(e) => {
          e.preventDefault();
          if (!locked) void submit();
        }}
      >
        {staff && (
          <div
            className={`border-b px-4 py-2.5 sm:px-6 ${internal ? 'bg-warning-soft' : 'bg-muted/40'}`}
          >
            <Label className="touch-label flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-primary"
                disabled={locked}
                checked={internal}
                onChange={(e) => {
                  if (!coordination?.isLocked()) onInternalChange(e.target.checked);
                }}
              />
              {copy('internal')}
            </Label>
            <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">
              {feedback(internal ? 'internalVisibility' : 'publicVisibility')}
            </p>
          </div>
        )}
        <div className="space-y-3 px-4 py-3 sm:px-6">
          <FormField
            control={form.control}
            name="body"
            render={({ field }) => (
              <FormItem id="ticket-reply">
                <FormLabel>{copy('reply')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    ref={(node) => {
                      field.ref(node);
                      textarea.current = node;
                    }}
                    disabled={locked}
                    rows={3}
                    placeholder={feedback(internal ? 'internalExample' : 'replyExample')}
                    className="min-h-20 max-h-64"
                    value={body}
                    onChange={(e) => {
                      if (coordination?.isLocked()) return;
                      field.onChange(e);
                      onBodyChange(e.target.value);
                    }}
                  />
                </FormControl>
                <FormDescription>
                  {feedback('replyInvalid')} {copy('formatHelp')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div
            role="group"
            aria-label={copy('formatting')}
            className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/40 p-1"
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
                variant="ghost"
                size="icon-sm"
                className="pointer-coarse:size-11"
                disabled={locked}
                aria-label={copy(key)}
                title={copy(key)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={action}
              >
                <Icon aria-hidden="true" />
              </Button>
            ))}
            <details className="min-w-0 open:basis-full">
              <summary className="cursor-pointer rounded-md px-2 py-2 text-sm hover:bg-muted pointer-coarse:min-h-11 pointer-coarse:py-3">
                <LinkIcon aria-hidden="true" className="inline size-4" /> {copy('insertLink')}
              </summary>
              <div className="mt-1 flex flex-wrap items-end gap-2 rounded-md border bg-card p-2">
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
              <summary className="cursor-pointer text-sm text-primary pointer-coarse:min-h-11 pointer-coarse:py-3">
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
                <TicketFileField
                  locale={locale}
                  input={field}
                  files={files}
                  preview={previewFile}
                  disabled={locked}
                  isLocked={() => !!coordination?.isLocked()}
                  emptyFocusRef={textarea}
                  onChange={(next) => {
                    for (const file of files) if (!next.includes(file)) uploaded.delete(file);
                    if (previewFile && !next.includes(previewFile)) setPreviewFile(null);
                    form.clearErrors('files');
                    setFiles(next);
                  }}
                  onInvalid={() =>
                    form.setError('files', { type: 'validate', message: copy('invalidReplyFiles') })
                  }
                  onPreview={setPreviewFile}
                  onAccessDenied={denyPreview}
                />
              </FormItem>
            )}
          />
          {form.formState.errors.root && <p role="alert">{feedback('validationUnavailable')}</p>}
        </div>
        <RecordEditorActions>
          <Button disabled={locked} type="submit" variant={internal ? 'warning' : 'default'}>
            {locked && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {locked ? copy('saving') : sendLabel}
          </Button>
        </RecordEditorActions>
      </form>
    </Form>
  );
}
