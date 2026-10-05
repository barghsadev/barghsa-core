import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, NativeSelect, Textarea } from '@barghsa/ui';
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
import { t, type Locale } from '@barghsa/i18n/app';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import { documentText } from '@barghsa/i18n/documents';
import {
  isAllowedInvoiceReceiptFile,
  uploadTicketAttachment,
} from '../lib/invoice-bank-receipt-upload.js';
import {
  ticketIntakeReceipt,
  ticketOptions,
  type TicketOptions,
  type TicketIntakeValues,
  type TicketCommandSender,
  type TicketCoordination,
} from '../lib/ticket-form.js';
import { useTicketFormFeedback } from '../hooks/useTicketFormFeedback.js';
import { FilePreview } from './FilePreview.js';
const empty: TicketIntakeValues = {
  subject: '',
  body: '',
  category: 'general',
  priority: 'normal',
  profileId: '',
  record: '',
  files: [],
};
export function TicketIntakeForm({
  actor,
  scope,
  locale,
  open,
  locked,
  coordination,
  send,
  failed,
  onSaved,
  formatDate,
}: {
  actor: string | null;
  scope: string;
  locale: Locale;
  open: boolean;
  locked: boolean;
  coordination: TicketCoordination;
  send: TicketCommandSender;
  failed: () => void;
  onSaved: (id: string) => Promise<void>;
  formatDate: (value: string | null) => string;
}) {
  const copy = (key: string) => tTicketForms(key, locale),
    text = (key: string) => t('tickets.' + key, locale);
  const current = useRef(scope);
  current.current = scope;
  const alive = useRef(true),
    uploaded = useRef(new Map<File, string>()),
    offered = useRef<TicketOptions | null>(null);
  const [options, setOptions] = useState<TicketOptions | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [recordPage, setRecordPage] = useState(1),
    [version, setVersion] = useState(0),
    [preview, setPreview] = useState<File | null>(null),
    [fileVersion, setFileVersion] = useState(0);
  const form = useZodForm<TicketIntakeValues>(
    async () => {
      const token = scope;
      const schema = await import('../lib/contract-review-signature-form-schemas.js');
      return alive.current && current.current === token
        ? schema.ticketIntakeSchema(
            copy,
            (id) => id === '' || !!offered.current?.profiles.some((p) => p.id === id),
            (id) => id === '' || !!offered.current?.records.some((r) => r.type + ':' + r.id === id),
            isAllowedInvoiceReceiptFile
          )
        : schema.inactiveTicketSchema;
    },
    { defaultValues: empty, validationUnavailableMessage: copy('validationUnavailable') }
  );
  const formFeedback = useTicketFormFeedback(
    form,
    scope,
    locked,
    coordination,
    { subject: copy('subjectInvalid'), body: copy('bodyInvalid') },
    text('error'),
    open && !!actor
  );
  const values = form.watch(),
    profileId = values.profileId,
    files = values.files;
  const pending = locked || form.formState.isSubmitting;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      uploaded.current.clear();
      offered.current = null;
    };
  }, []);
  useEffect(() => {
    if (!open || !actor) return;
    const controller = new AbortController(),
      token = scope;
    setLoading(true);
    setError('');
    setOptions(null);
    offered.current = null;
    void fetch(
      '/api/tickets/options' +
        (profileId
          ? '?profileId=' + encodeURIComponent(profileId) + '&recordPage=' + recordPage
          : ''),
      { credentials: 'include', signal: controller.signal }
    )
      .then(async (response) => {
        if ([401, 403].includes(response.status)) {
          if (!controller.signal.aborted && current.current === token) coordination.denied();
          throw new Error('forbidden');
        }
        if (!response.ok) throw new Error('error');
        const parsed = ticketOptions(await response.json());
        if (!parsed) throw new Error('error');
        if (!controller.signal.aborted && alive.current && current.current === token) {
          offered.current = parsed;
          setOptions(parsed);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && current.current === token)
          setError(reason instanceof Error ? reason.message : 'error');
      })
      .finally(() => {
        if (!controller.signal.aborted && current.current === token) setLoading(false);
      });
    return () => controller.abort();
  }, [open, actor, scope, profileId, recordPage, version]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!actor || !open || loading || !offered.current || !coordination.claim('intake')) return;
    const raw = { ...form.getValues(), files: [...form.getValues('files')] },
      token = scope,
      record = offered.current.records.find((r) => r.type + ':' + r.id === raw.record);
    try {
      const submitValidated = async (valid: TicketIntakeValues) => {
        if (!alive.current || current.current !== token || !coordination.isCurrent()) return;
        if (
          ['subject', 'body', 'category', 'priority', 'profileId', 'record'].some(
            (name) =>
              valid[name as keyof TicketIntakeValues] !== raw[name as keyof TicketIntakeValues]
          ) ||
          valid.files.length !== raw.files.length ||
          valid.files.some((file, index) => file !== raw.files[index])
        )
          return;
        const keys: string[] = [];
        for (const file of raw.files) {
          let key = uploaded.current.get(file);
          if (!key) {
            key = (await uploadTicketAttachment(file, raw.profileId || null)) ?? undefined;
            if (!key) throw new Error('upload');
            if (!alive.current || current.current !== token || !coordination.isCurrent()) return;
            uploaded.current.set(file, key);
          }
          keys.push(key);
        }
        if (!alive.current || current.current !== token || !coordination.isCurrent()) return;
        const body = {
          subject: raw.subject.trim(),
          body: raw.body.trim(),
          category: raw.category,
          priority: raw.priority,
          profileId: raw.profileId || null,
          attachments: keys,
          ...(record ? { relatedEntityType: record.type, relatedEntityId: record.id } : {}),
          idempotencyKey: crypto.randomUUID(),
        };
        await send({
          owner: 'intake',
          path: '/api/tickets',
          method: 'POST',
          status: 201,
          body,
          confirmed: (v) => ticketIntakeReceipt(v, actor, body),
          fields: formFeedback.fields,
          accepted: async (v) => {
            if (!alive.current || current.current !== token) return;
            form.reset(empty);
            uploaded.current.clear();
            setPreview(null);
            setFileVersion((x) => x + 1);
            setRecordPage(1);
            await onSaved((v as { id: string }).id);
          },
        });
      };
      await form.handleSubmit(submitValidated, (errors) => {
        formFeedback.invalid(errors);
        coordination.release('intake');
      })(event);
    } catch {
      if (alive.current && current.current === token) failed();
    } finally {
      coordination.release('intake');
    }
  }
  function field(
    name: Exclude<keyof TicketIntakeValues, 'files'>,
    label: string,
    choices?: { value: string; label: string }[]
  ) {
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem id={'ticket-' + (name === 'profileId' ? 'profile' : name)}>
            <FormLabel>{text(label)}</FormLabel>
            <FormControl>
              {choices ? (
                <NativeSelect
                  {...field}
                  disabled={pending}
                  onChange={(e) => {
                    if (coordination.isLocked()) return;
                    field.onChange(e);
                    if (name === 'profileId') {
                      form.setValue('record', '');
                      setRecordPage(1);
                      uploaded.current.clear();
                      setPreview(null);
                    }
                  }}
                >
                  {choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : name === 'body' ? (
                <Textarea {...field} disabled={pending} rows={4} />
              ) : (
                <Input {...field} disabled={pending} />
              )}
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }
  return (
    <Form {...form}>
      <form
        ref={formFeedback.element}
        data-slot="ticket-intake-form"
        aria-label={text('submit')}
        noValidate
        onSubmit={(e) => void submit(e)}
        className="rounded border bg-card text-card-foreground p-4"
      >
        <fieldset disabled={pending || !actor} className="flex flex-col gap-3">
          {field('subject', 'subject')}
          {field('body', 'body')}
          {field(
            'category',
            'category',
            ['general', 'billing', 'orders', 'privacy'].map((v) => ({
              value: v,
              label: text('category.' + v),
            }))
          )}
          {field(
            'priority',
            'priority',
            ['normal', 'high'].map((v) => ({ value: v, label: text(v) }))
          )}
          {loading ? (
            open && <p role="status">{text('loading')}</p>
          ) : options ? (
            <>
              {field('profileId', 'profile', [
                { value: '', label: text('noProfile') },
                ...options.profiles.map((p) => ({
                  value: p.id,
                  label: p.title ?? text('unnamed'),
                })),
              ])}
              {profileId && (
                <>
                  {field('record', 'related', [
                    { value: '', label: text('none') },
                    ...options.records.map((r) => ({
                      value: r.type + ':' + r.id,
                      label:
                        text(r.type) + ' · ' + r.id.slice(-8) + ' · ' + formatDate(r.created_at),
                    })),
                  ])}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={recordPage === 1}
                      onClick={() => {
                        if (coordination.isLocked()) return;
                        form.setValue('record', '');
                        setRecordPage((p) => p - 1);
                      }}
                    >
                      {text('previous')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!options.hasMoreRecords}
                      onClick={() => {
                        if (coordination.isLocked()) return;
                        form.setValue('record', '');
                        setRecordPage((p) => p + 1);
                      }}
                    >
                      {text('next')}
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            open && (
              <div role="alert">
                <p>{text(error === 'forbidden' ? 'forbidden' : 'optionsError')}</p>
                {error !== 'forbidden' && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (!coordination.isLocked()) setVersion((v) => v + 1);
                    }}
                  >
                    {text('retry')}
                  </Button>
                )}
              </div>
            )
          )}
          <FormField
            control={form.control}
            name="files"
            render={({ field }) => (
              <FormItem id="ticket-files">
                <FormLabel>{text('files')}</FormLabel>
                <FormControl>
                  <input
                    key={fileVersion}
                    ref={field.ref}
                    name={field.name}
                    onBlur={field.onBlur}
                    type="file"
                    multiple
                    accept="application/pdf,image/jpeg,image/png"
                    disabled={pending}
                    onChange={(e) => {
                      if (coordination.isLocked()) return;
                      setPreview(null);
                      field.onChange(Array.from(e.target.files ?? []));
                    }}
                    className="block w-full text-sm"
                  />
                </FormControl>
                <FormDescription>{text('fileHelp')}</FormDescription>
                <FormMessage />
                <ul className="flex flex-col gap-2">
                  {files.filter(isAllowedInvoiceReceiptFile).map((file, index) => (
                    <li key={index} className="flex min-w-0 flex-wrap items-center gap-2">
                      <bdi className="min-w-0 flex-1 break-words">{file.name}</bdi>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={documentText('preview', locale) + ': ' + file.name}
                        aria-expanded={preview === file}
                        onClick={() => {
                          if (!coordination.isLocked())
                            setPreview((p) => (p === file ? null : file));
                        }}
                      >
                        {documentText(preview === file ? 'hidePreview' : 'preview', locale)}
                      </Button>
                    </li>
                  ))}
                </ul>
                {preview && files.includes(preview) && (
                  <FilePreview
                    file={preview}
                    name={preview.name}
                    locale={locale}
                    onAccessDenied={() => {
                      form.reset(empty);
                      uploaded.current.clear();
                      setPreview(null);
                      coordination.denied();
                    }}
                  />
                )}
              </FormItem>
            )}
          />
          {form.formState.errors.root && <p role="alert">{copy('validationUnavailable')}</p>}
          <Button type="submit" disabled={pending || loading || !options}>
            {pending && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {text(pending ? 'saving' : 'submit')}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
