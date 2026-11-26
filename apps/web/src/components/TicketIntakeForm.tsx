import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
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
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorGrid,
  recordEditorSurface,
} from './RecordEditorLayout.js';
import { CatalogueChoicePicker } from './CatalogueChoicePicker.js';
import { TicketFileField } from './TicketFileField.js';
import type { TicketRelatedRecord } from '../lib/support-list-query.js';
const empty: TicketIntakeValues = {
  subject: '',
  body: '',
  category: 'general',
  priority: 'normal',
  profileId: '',
  record: '',
  files: [],
};
const noLinkedRecord = 'none';
export function TicketIntakeForm({
  actor,
  scope,
  locale,
  open,
  related,
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
  related?: TicketRelatedRecord;
  locked: boolean;
  coordination: TicketCoordination;
  send: TicketCommandSender;
  failed: () => void;
  onSaved: (id: string) => Promise<void>;
  formatDate: (value: string | null) => string;
}) {
  const copy = (key: string) => tTicketForms(key, locale),
    text = (key: string) => t('tickets.' + key, locale);
  const reader = useId();
  const client = useQueryClient();
  const profileRevision = useProfileContextRevision();
  const current = useRef(scope);
  current.current = scope;
  const alive = useRef(true),
    uploaded = useRef(new Map<File, string>()),
    offered = useRef<TicketOptions | null>(null),
    prefilled = useRef(false);
  const [optionsResult, setOptionsResult] = useState<{
      key: string;
      options: TicketOptions | null;
      error?: 'forbidden' | 'load';
    } | null>(null),
    [profileResult, setProfileResult] = useState<{
      key: string;
      profiles: TicketOptions['profiles'];
    } | null>(null),
    [recordResult, setRecordResult] = useState<{
      key: string;
      records: TicketOptions['records'];
    } | null>(null),
    [recordPage, setRecordPage] = useState(1),
    [version, setVersion] = useState(0),
    [preview, setPreview] = useState<File | null>(null),
    [relatedUnavailable, setRelatedUnavailable] = useState(false);
  const form = useZodForm<TicketIntakeValues>(
    async () => {
      const token = scope;
      const schema = await import('../lib/ticket-form-schemas.js');
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
  const { profileId, record: selectedRecordKey, files } = form.watch();
  const pending = locked || form.formState.isSubmitting;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      uploaded.current.clear();
      offered.current = null;
    };
  }, []);
  const optionsKey =
    open && actor
      ? JSON.stringify([
          reader,
          scope,
          actor,
          profileRevision,
          'ticket-intake-options',
          profileId,
          recordPage,
          related?.relatedType,
          related?.relatedId,
          version,
        ])
      : null;
  const currentOptionsKey = useRef(optionsKey);
  currentOptionsKey.current = optionsKey;
  const profileKey = JSON.stringify([scope, actor, profileRevision]);
  const recordKey = JSON.stringify([
    profileKey,
    profileId,
    related?.relatedType,
    related?.relatedId,
  ]);
  const result = optionsResult?.key === optionsKey ? optionsResult : null;
  const options = result?.options ?? null;
  const error = result?.error;
  const priorRecords =
    recordPage > 1 && error !== 'forbidden' && recordResult?.key === recordKey
      ? recordResult.records
      : [];
  const records = options?.records ?? priorRecords;
  const selectedRecord = records.find((r) => r.type + ':' + r.id === selectedRecordKey);
  const loading = optionsKey !== null && !result;
  const recordChoices = records.map((record) => {
    const reference = record.contractNumber ?? `…${record.id.slice(-8)}`;
    const date = formatDate(record.created_at);
    return {
      id: record.type + ':' + record.id,
      title: `${text(record.type)} · \u2066${reference}\u2069`,
      detail: date,
      searchText: `${record.id} ${record.created_at.slice(0, 10)} ${date}`,
    };
  });
  const profiles =
    open && actor && error !== 'forbidden' && profileResult?.key === profileKey
      ? profileResult.profiles
      : null;
  const optionsQueryKey =
    optionsKey && actor
      ? queryKeys.catalogue.detail(
          {
            context: 'account',
            ownerId: profileId || actor,
            accountId: actor,
            revision: profileRevision,
          },
          optionsKey
        )
      : null;
  const optionsQuery = useServerDetailQuery<{ status: number; value: unknown }>({
    queryKey: optionsQueryKey,
    enabled: false,
    manual: true,
    read: async (signal) => {
      const query = new URLSearchParams();
      if (profileId) {
        query.set('profileId', profileId);
        query.set('recordPage', String(recordPage));
      }
      if (related) {
        query.set('relatedType', related.relatedType);
        query.set('relatedId', related.relatedId);
      }
      const response = await fetch('/api/tickets/options' + (query.size ? '?' + query : ''), {
        credentials: 'include',
        signal,
      });
      if ([401, 403].includes(response.status)) return { status: response.status, value: null };
      if (profileId && response.status === 404) return { status: 404, value: null };
      if (!response.ok) throw new Error('error');
      return { status: response.status, value: (await response.json()) as unknown };
    },
  });
  useEffect(() => {
    setOptionsResult(null);
    offered.current = null;
    if (!optionsKey) {
      setProfileResult(null);
      setRecordResult(null);
      return;
    }
    const controller = new AbortController(),
      token = scope;
    const currentRead = () =>
      !controller.signal.aborted &&
      alive.current &&
      current.current === token &&
      currentOptionsKey.current === optionsKey;
    void optionsQuery
      .refetch()
      .then((reply) => {
        if (!currentRead()) return;
        if (!reply.isSuccess || !reply.data) throw new Error('error');
        if ([401, 403].includes(reply.data.status)) {
          setRecordResult(null);
          coordination.denied();
          throw new Error('forbidden');
        }
        const parsed = ticketOptions(reply.data.value);
        if (
          reply.data.status === 404 ||
          (profileId && parsed && !parsed.profiles.some((p) => p.id === profileId))
        ) {
          setRecordResult(null);
          form.setValue('record', '');
          throw new Error('error');
        }
        if (!parsed) throw new Error('error');
        const records =
          recordPage === 1
            ? parsed.records
            : [
                ...new Map(
                  [...priorRecords, ...parsed.records].map((r) => [r.type + ':' + r.id, r])
                ).values(),
              ];
        const accepted = { ...parsed, records };
        offered.current = accepted;
        setOptionsResult({ key: optionsKey, options: accepted });
        setProfileResult({ key: profileKey, profiles: parsed.profiles });
        setRecordResult({ key: recordKey, records });
        if (related && !prefilled.current) {
          if (!profileId && parsed.suggestedProfileId) {
            form.setValue('profileId', parsed.suggestedProfileId);
          } else {
            prefilled.current = true;
            const record = parsed.records.find(
              (item) => item.id === related.relatedId && item.type === related.relatedType
            );
            if (record) form.setValue('record', record.type + ':' + record.id);
            else setRelatedUnavailable(true);
          }
        }
      })
      .catch((reason: unknown) => {
        if (currentRead())
          setOptionsResult({
            key: optionsKey,
            options: null,
            error: reason instanceof Error && reason.message === 'forbidden' ? 'forbidden' : 'load',
          });
      });
    return () => {
      controller.abort();
      if (optionsQueryKey) void client.cancelQueries({ queryKey: optionsQueryKey, exact: true });
    };
  }, [
    open,
    actor,
    scope,
    profileId,
    recordPage,
    version,
    profileRevision,
    related?.relatedId,
    related?.relatedType,
  ]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!actor || !options || !offered.current || !coordination.claim('intake')) return;
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
            setRecordPage(1);
            setRecordResult(null);
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
    name: Exclude<keyof TicketIntakeValues, 'files' | 'record'>,
    label: string,
    choices?: { value: string; label: string }[],
    context?: { disabled?: boolean; help?: ReactNode }
  ) {
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem id={'ticket-' + (name === 'profileId' ? 'profile' : name)} className="min-w-0">
            <FormLabel>{text(label)}</FormLabel>
            <FormControl>
              {choices ? (
                <NativeSelect
                  {...field}
                  className={
                    context?.disabled
                      ? 'w-full min-w-0 has-[select:disabled]:opacity-100 [&_select]:border-border [&_select]:text-muted-foreground'
                      : 'w-full min-w-0'
                  }
                  aria-required={name === 'category' || name === 'priority' || undefined}
                  disabled={pending || context?.disabled}
                  onChange={(e) => {
                    if (coordination.isLocked()) return;
                    field.onChange(e);
                    if (name === 'profileId') {
                      form.setValue('record', '');
                      setRecordPage(1);
                      setRecordResult(null);
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
                <Textarea
                  {...field}
                  aria-required="true"
                  disabled={pending}
                  rows={3}
                  placeholder={copy('bodyExample')}
                  className="min-h-[4.5rem] max-h-64"
                />
              ) : (
                <Input
                  {...field}
                  aria-required="true"
                  disabled={pending}
                  placeholder={name === 'subject' ? copy('subjectExample') : undefined}
                />
              )}
            </FormControl>
            {context?.help && <FormDescription>{context.help}</FormDescription>}
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
        className={recordEditorSurface}
      >
        <fieldset disabled={pending || !actor} className="min-w-0 border-0 p-0">
          <RecordEditorSection title={copy('requestDetails')}>
            {field('subject', 'subject')}
            {field('body', 'body')}
          </RecordEditorSection>
          <RecordEditorSection title={copy('routingDetails')}>
            <div className="grid min-w-0 grid-cols-2 gap-3">
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
            </div>
            {relatedUnavailable && (
              <p role="status" className="text-sm text-muted-foreground">
                {copy('relatedUnavailable')}
              </p>
            )}
            <div className={recordEditorGrid}>
              {field(
                'profileId',
                'profile',
                profiles
                  ? [
                      { value: '', label: text('noProfile') },
                      ...profiles.map((p) => ({
                        value: p.id,
                        label: p.title ?? text('unnamed'),
                      })),
                    ]
                  : [
                      {
                        value: profileId,
                        label: copy(loading ? 'profilesLoading' : 'profilesUnavailable'),
                      },
                    ],
                {
                  disabled: !profiles,
                  ...(!profileId && profiles?.length ? { help: copy('recordLinkHelp') } : {}),
                }
              )}
              {profileId && (
                <div className="min-w-0 space-y-1.5">
                  <FormField
                    control={form.control}
                    name="record"
                    render={({ field }) => (
                      <FormItem id="ticket-record" className="min-w-0">
                        <FormLabel>{text('related')}</FormLabel>
                        <FormControl>
                          {recordChoices.length ? (
                            <CatalogueChoicePicker
                              id="ticket-record"
                              field={field}
                              locale={locale}
                              options={
                                field.value
                                  ? [
                                      ...recordChoices,
                                      { id: noLinkedRecord, title: copy('recordNone') },
                                    ]
                                  : recordChoices
                              }
                              selected={field.value}
                              required={false}
                              disabled={pending || !options}
                              labels={{
                                search: copy('recordSearch'),
                                noMatches: copy('recordNoMatches'),
                                empty: copy('recordsEmpty'),
                                unavailable: copy('recordsUnavailable'),
                              }}
                              onChange={(id) => {
                                if (!coordination.isLocked())
                                  field.onChange(id === noLinkedRecord ? '' : id);
                              }}
                            />
                          ) : (
                            <Input
                              disabled
                              className="text-muted-foreground disabled:opacity-100"
                              value={copy(
                                loading
                                  ? 'recordsLoading'
                                  : error
                                    ? 'recordsUnavailable'
                                    : 'recordsEmpty'
                              )}
                            />
                          )}
                        </FormControl>
                        {selectedRecord && !selectedRecord.contractNumber && (
                          <FormDescription>
                            {copy('recordReference')}{' '}
                            <bdi dir="ltr" className="[overflow-wrap:anywhere]">
                              {selectedRecord.id}
                            </bdi>
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {!error &&
                    (recordPage > 1 || options?.hasMoreRecords) &&
                    (options && !options.hasMoreRecords ? (
                      <p role="status" className="text-xs text-muted-foreground">
                        {copy('allRecordsLoaded')}
                      </p>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-ms-2 text-primary"
                        disabled={!options}
                        onClick={() => {
                          if (!coordination.isLocked() && options?.hasMoreRecords)
                            setRecordPage((p) => p + 1);
                        }}
                      >
                        {copy(loading ? 'recordsLoading' : 'loadOlderRecords')}
                      </Button>
                    ))}
                </div>
              )}
              {loading && (
                <p role="status" className="sr-only">
                  {copy(profileId ? 'recordsLoading' : 'profilesLoading')}
                </p>
              )}
            </div>
            {error && (
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
            )}
          </RecordEditorSection>
          <div className="space-y-3 px-4 py-3 sm:px-6">
            <FormField
              control={form.control}
              name="files"
              render={({ field }) => (
                <FormItem id="ticket-files" className="min-w-0 space-y-2">
                  <TicketFileField
                    locale={locale}
                    input={field}
                    files={files}
                    preview={preview}
                    disabled={pending}
                    isLocked={coordination.isLocked}
                    onChange={(next) => {
                      for (const file of files)
                        if (!next.includes(file)) uploaded.current.delete(file);
                      if (preview && !next.includes(preview)) setPreview(null);
                      form.clearErrors('files');
                      field.onChange(next);
                    }}
                    onInvalid={() =>
                      form.setError('files', { type: 'validate', message: copy('filesInvalid') })
                    }
                    onPreview={setPreview}
                    onAccessDenied={() => {
                      form.reset(empty);
                      uploaded.current.clear();
                      setPreview(null);
                      coordination.denied();
                    }}
                  />
                </FormItem>
              )}
            />
            {form.formState.errors.root && <p role="alert">{copy('validationUnavailable')}</p>}
          </div>
          <RecordEditorActions>
            <Button type="submit" disabled={pending || !options}>
              {pending && (
                <span
                  aria-hidden="true"
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {text(pending ? 'saving' : 'submit')}
            </Button>
          </RecordEditorActions>
        </fieldset>
      </form>
    </Form>
  );
}
