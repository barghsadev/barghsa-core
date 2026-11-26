import { readWithDeadline } from '../lib/server-query-client.js';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { toast } from '../lib/toast-api.js';
import { queryKeys } from '../lib/query-keys.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type AriaAttributes,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  LoadingStatus,
  Alert,
  AlertDescription,
  Button,
  DatePicker,
  Input,
  ListRefreshButton,
  NativeSelect,
  buttonVariants,
  datePickerCalendarDate,
} from '@barghsa/ui';
import { CompactFieldFeedback } from './CompactFieldFeedback.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
import { Form, FormControl, FormField, FormItem, FormLabel, useZodForm } from '@barghsa/ui/form';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  confirmedShipmentRead,
  emptyShipment,
  shipmentBody,
  shipmentReceipt,
  validPostalGuidance,
  type ShipmentBody,
  type ShipmentDraft,
} from '../lib/solar-postal-form.js';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { documentRequest, type BusinessDocument, type DocumentPage } from '../lib/documents.js';
import { DocumentUpload } from './DocumentUpload.js';
import { SolarPostalTrackingSummary } from './SolarPostalTrackingSummary.js';

interface Guidance {
  fa: string;
  en: string;
  destinationAddress: string;
  contactDetails: string;
  originals: Array<{ fa: string; en: string }>;
}
interface Postal {
  status: string;
  courier: string | null;
  tracking_number: string | null;
  send_date: string | null;
  receipt_image_id: string | null;
  staff_notes: string | null;
  estimated_arrival_date?: string | null;
  tracking_url?: string | null;
  tracking_note?: string | null;
  tracking_recorded_at?: string | null;
}
interface State {
  requestStatus: string;
  postal: Postal | null;
  guidance: Guidance;
}

function ShipmentCalendar({
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
  ...props
}: ComponentProps<typeof DatePicker> & Pick<AriaAttributes, 'aria-invalid' | 'aria-describedby'>) {
  return (
    <DatePicker
      {...props}
      triggerProps={{
        ...props.triggerProps,
        'aria-invalid': invalid,
        'aria-describedby': describedBy,
      }}
    />
  );
}

export function SolarPostalPanel(props: Parameters<typeof OwnedSolarPostalPanel>[0]) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  return <OwnedSolarPostalPanel key={JSON.stringify([actor, profileRevision])} {...props} />;
}
function OwnedSolarPostalPanel({
  requestId,
  profileId,
  receiptView,
  siteAddress,
  editorHeader,
}: {
  requestId: string;
  profileId: string;
  receiptView?: 'shipment' | 'upload';
  siteAddress?: string | null;
  editorHeader?: (blocked: () => boolean, disabled: boolean) => ReactNode;
}) {
  const client = useQueryClient();
  const reader = useId();
  const profileRevision = useProfileContextRevision();
  const readSequence = useRef(0);
  const actor = useAccountUser();
  const postalReads = useRef(new Set<AbortController>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const reads = postalReads.current;
    return () => {
      mounted.current = false;
      for (const controller of reads) controller.abort();
      reads.clear();
    };
  }, [client]);
  async function readPostal(signal?: AbortSignal) {
    if (!mounted.current || signal?.aborted) throw new Error('Obsolete postal read');
    const controller = new AbortController();
    const key = queryKeys.solar.detail(
      { context: 'customer', ownerId: profileId, accountId: actor, revision: profileRevision },
      JSON.stringify([requestId, 'postal', reader, ++readSequence.current])
    );
    const cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
    const abort = () => controller.abort();
    controller.signal.addEventListener('abort', cancel, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    postalReads.current.add(controller);
    try {
      return await client.fetchQuery({
        queryKey: key,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: ({ signal }) =>
          readWithDeadline(signal, async (transport) => {
            const response = await fetch(
              `/api/solar/requests/${encodeURIComponent(requestId)}/postal`,
              { credentials: 'include', signal: transport }
            );
            return {
              ok: response.ok,
              status: response.status,
              data: response.ok ? ((await response.json()) as unknown) : null,
            };
          }),
      });
    } finally {
      controller.signal.removeEventListener('abort', cancel);
      signal?.removeEventListener('abort', abort);
      postalReads.current.delete(controller);
    }
  }
  const locale = useLocale();
  const today = new Date().toISOString().slice(0, 10);
  const copy = (key: string) => tSolar(key, locale);
  const [state, setState] = useState<State | null>(null);
  const [images, setImages] = useState<BusinessDocument[]>([]);
  const messages = {
    courier: copy('postalCourierInvalid'),
    trackingNumber: copy('postalTrackingInvalid'),
    sendDate: copy('postalSendDateInvalid'),
    receiptImageId: copy('postalReceiptInvalid'),
  };
  const form = useZodForm<ShipmentDraft>(
    async () =>
      (await import('../lib/solar-postal-form-schemas.js')).shipmentSchema(
        messages,
        new Date().toISOString().slice(0, 10)
      ),
    {
      defaultValues: emptyShipment,
      validationUnavailableMessage: copy('documentValidationUnavailable'),
    }
  );
  const ownedFields = useActionFieldErrors(form, messages, copy('postalError'));
  const dirty = useRef(false);
  dirty.current = form.formState.isDirty;
  const editGeneration = useRef(0);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [imageStatus, setImageStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const pendingShipment = useRef<{ scope: string; body: ShipmentBody } | null>(null);
  const [latestReceipt, setLatestReceipt] = useState<BusinessDocument | null>(null);
  const [revision, setRevision] = useState(0);
  const [imageRevision, setImageRevision] = useState(0);
  const [error, setError] = useState(false);
  const sending = form.formState.isSubmitting;
  const [loadError, setLoadError] = useState(false);
  const scope = `${requestId}:${profileId}`;
  const [acceptedScope, setAcceptedScope] = useState(scope);
  const currentScope = useRef(scope);
  const postalUnavailable = useRef(false);
  const generation = useRef(0);
  if (currentScope.current !== scope) {
    currentScope.current = scope;
    ++generation.current;
  }
  useEffect(() => {
    ++generation.current;
    postalUnavailable.current = false;
    form.reset(emptyShipment);
    pendingShipment.current = null;
    setUnconfirmed(false);
    setState(null);
    setError(false);
    setLoadError(false);
    setLatestReceipt(null);
    ++editGeneration.current;
  }, [scope]);
  useEffect(
    () => () => {
      ++generation.current;
    },
    []
  );
  const isEditable = (value: State) =>
    value.requestStatus === 'waiting_for_postal_submission' &&
    ['waiting_for_shipment', 'incomplete', 'not_received'].includes(value.postal?.status ?? '');
  function postalState(value: unknown): State {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('postal');
    const result = value as State;
    if (
      typeof result.requestStatus !== 'string' ||
      !validPostalGuidance(result.guidance) ||
      (result.postal !== null &&
        (!result.postal ||
          typeof result.postal.status !== 'string' ||
          !['courier', 'tracking_number', 'send_date', 'receipt_image_id', 'staff_notes'].every(
            (field) =>
              result.postal?.[field as keyof Postal] === null ||
              typeof result.postal?.[field as keyof Postal] === 'string'
          )))
    )
      throw new Error('postal');
    return result;
  }
  function accept(value: State, editedAtRead: number) {
    if (postalUnavailable.current) setImageRevision((value) => value + 1);
    postalUnavailable.current = false;
    setState(value);
    setAcceptedScope(scope);
    setLoadError(false);
    const pending = pendingShipment.current;
    if (pending?.scope === scope && confirmedShipmentRead(value, pending.body)) {
      pendingShipment.current = null;
      setUnconfirmed(false);
      setError(false);
      form.reset(emptyShipment);
    } else if (!pending && !dirty.current && editedAtRead === editGeneration.current) {
      form.reset({
        courier: value.postal?.courier ?? '',
        trackingNumber: value.postal?.tracking_number ?? '',
        sendDate: value.postal?.send_date?.slice(0, 10) ?? '',
        receiptImageId: value.postal?.receipt_image_id ?? '',
      });
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const capturedGeneration = generation.current,
      editedAtRead = editGeneration.current;
    setState(null);
    setLoadError(false);
    void readPostal(controller.signal)
      .then(async (response) => {
        if (!response.ok) throw new Error('postal');
        return postalState(response.data);
      })
      .then((value) => {
        if (!controller.signal.aborted && capturedGeneration === generation.current)
          accept(value, editedAtRead);
      })
      .catch(() => {
        if (!controller.signal.aborted && capturedGeneration === generation.current) {
          postalUnavailable.current = true;
          setState(null);
          setImages([]);
          setLoadError(true);
        }
      });
    return () => controller.abort();
  }, [scope, revision, client, actor, profileRevision, reader]);
  useEffect(() => {
    const controller = new AbortController();
    setImages([]);
    setImageStatus('loading');
    const capturedGeneration = generation.current;
    const params = new URLSearchParams({
      businessRecordType: 'solar_request',
      businessRecordId: requestId,
      profileId,
      category: 'image',
    });
    const key = queryKeys.solar.list(
      { context: 'customer', ownerId: profileId, accountId: actor, revision: profileRevision },
      params,
      ++readSequence.current
    );
    const queryKey = [...key, reader, 'postal-images'] as const;
    const cancel = () => void client.cancelQueries({ queryKey, exact: true });
    controller.signal.addEventListener('abort', cancel, { once: true });
    void client
      .fetchQuery({
        queryKey,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: ({ signal }) =>
          readWithDeadline(signal, (transport) =>
            documentRequest<DocumentPage>(`/api/documents?${params}`, { signal: transport })
          ),
      })
      .then((value) => {
        if (
          !controller.signal.aborted &&
          capturedGeneration === generation.current &&
          !postalUnavailable.current
        ) {
          setImages(
            value.documents.filter(
              (document) => document.state === 'Available' && document.uploadedByType === 'customer'
            )
          );
          setImageStatus('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && capturedGeneration === generation.current)
          setImageStatus('error');
      });
    return () => {
      controller.abort();
      controller.signal.removeEventListener('abort', cancel);
    };
  }, [requestId, profileId, imageRevision, client, actor, profileRevision, reader]);
  function submit(event: FormEvent<HTMLFormElement>) {
    if (unconfirmed || form.isSubmissionPending()) {
      event.preventDefault();
      return;
    }
    const capturedGeneration = generation.current;
    void form.handleSubmit(async (draft) => {
      if (capturedGeneration !== generation.current || !state || !isEditable(state)) return;
      const body = shipmentBody(draft);
      pendingShipment.current = { scope, body };
      setError(false);
      try {
        const response = await fetch(
          `/api/solar/requests/${encodeURIComponent(requestId)}/postal/shipment`,
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
          }
        );
        const value = await response.json().catch(() => null);
        if (capturedGeneration !== generation.current) return;
        if (!response.ok) {
          if (
            response.status === 400 &&
            value?.error?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
            Array.isArray(value.error.fields) &&
            ownedFields(value.error.fields)
          ) {
            pendingShipment.current = null;
            return;
          }
          if ([401, 403, 404].includes(response.status)) {
            postalUnavailable.current = true;
            setState(null);
            setImages([]);
            setLoadError(true);
          }
          if (
            response.status >= 400 &&
            response.status < 500 &&
            typeof value?.error?.code === 'string' &&
            !!value.error.code &&
            typeof value.error.message === 'string' &&
            typeof value.error.correlationId === 'string' &&
            !!value.error.correlationId
          ) {
            pendingShipment.current = null;
            setUnconfirmed(false);
            setError(true);
            return;
          }
          throw new Error('shipment');
        }
        if (!shipmentReceipt(value)) throw new Error('receipt');
        const read = await readPostal();
        if (capturedGeneration !== generation.current) return;
        if (!read.ok) {
          postalUnavailable.current = true;
          setState(null);
          setImages([]);
          setLoadError(true);
          throw new Error('read');
        }
        let saved: State;
        try {
          saved = postalState(read.data);
        } catch {
          if (capturedGeneration === generation.current) {
            postalUnavailable.current = true;
            setState(null);
            setImages([]);
            setLoadError(true);
          }
          throw new Error('read');
        }
        if (capturedGeneration !== generation.current) return;
        if (!confirmedShipmentRead(saved, body)) {
          setState(saved);
          throw new Error('receipt');
        }
        accept(saved, editGeneration.current);
        toast.success(confirmationText('recorded', locale));
      } catch {
        if (capturedGeneration === generation.current) {
          setError(true);
          setUnconfirmed(true);
        }
      }
    })(event);
  }
  const visible = acceptedScope === scope ? state : null;
  const editable = !!visible && isEditable(visible);
  const showForm =
    editable || (!!visible && unconfirmed && pendingShipment.current?.scope === scope);
  const uploadGeneration = generation.current;
  const returningToShipment = useRef(false);
  const uploadingReceipt = receiptView === 'upload';
  useEffect(() => {
    if (uploadingReceipt) returningToShipment.current = true;
    else if (returningToShipment.current && showForm) {
      returningToShipment.current = false;
      form.setFocus('receiptImageId');
    }
  }, [uploadingReceipt, showForm, form.setFocus]);
  const selectableImages =
    latestReceipt && !images.some((image) => image.id === latestReceipt.id)
      ? [latestReceipt, ...images]
      : images;

  if (uploadingReceipt)
    return (
      <ShipmentReceiptEditor
        requestId={requestId}
        profileId={profileId}
        siteAddress={siteAddress}
        available={editable && !unconfirmed && !sending}
        loading={!visible && !loadError}
        loadError={loadError}
        onRetry={() => setRevision((value) => value + 1)}
        onUploaded={(document) => {
          if (uploadGeneration !== generation.current) return;
          if (document.state === 'Available') {
            ++editGeneration.current;
            setLatestReceipt(document);
            form.setValue('receiptImageId', document.id, {
              shouldDirty: true,
              shouldValidate: true,
            });
          }
          setImageRevision((value) => value + 1);
        }}
      />
    );
  return (
    <>
      {editorHeader?.(() => form.isSubmissionPending(), sending)}
      <section className="min-w-0 space-y-3" aria-label={copy('postalStage')}>
        <header className="flex items-center justify-between gap-2">
          <div className="space-y-0.5">
            <h2 className="text-base font-semibold">{copy('postalStage')}</h2>
            {visible && (
              <p role="status" className="text-sm text-muted-foreground">
                {copy('postalStatus')}{' '}
                <span className="ms-1 font-medium text-foreground">
                  {copy(`postal_${visible.postal?.status ?? 'waiting_for_shipment'}`)}
                </span>
              </p>
            )}
          </div>
          <ListRefreshButton
            label={copy('postalTrackingReload')}
            disabled={sending}
            onClick={() => {
              if (!form.isSubmissionPending()) setRevision((value) => value + 1);
            }}
          />
        </header>
        {!visible && !loadError && <LoadingStatus>{copy('loading')}</LoadingStatus>}
        {visible && (
          <>
            <div className="space-y-3 rounded-xl border bg-card px-4 py-3.5 text-sm sm:px-5">
              <p className="whitespace-pre-wrap wrap-anywhere">{visible.guidance[locale]}</p>
              {(visible.guidance.destinationAddress || visible.guidance.contactDetails) && (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {visible.guidance.destinationAddress && (
                    <div>
                      <dt className="font-semibold">{copy('postalDestination')}</dt>
                      <dd
                        dir="auto"
                        className="mt-1 whitespace-pre-wrap wrap-anywhere text-muted-foreground"
                      >
                        {visible.guidance.destinationAddress}
                      </dd>
                    </div>
                  )}
                  {visible.guidance.contactDetails && (
                    <div>
                      <dt className="font-semibold">{copy('postalContact')}</dt>
                      <dd
                        dir="auto"
                        className="mt-1 whitespace-pre-wrap wrap-anywhere text-muted-foreground"
                      >
                        {visible.guidance.contactDetails}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {!!visible.guidance.originals.length && (
                <div className="space-y-1 border-t pt-2.5">
                  <h3 className="font-semibold">{copy('postalOriginals')}</h3>
                  <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
                    {visible.guidance.originals.map((item, index) => (
                      <li key={index} className="wrap-anywhere">
                        {item[locale]}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {visible.postal?.staff_notes && (
              <div className="space-y-1 rounded-lg border-s-2 border-warning/45 bg-muted/25 px-3 py-2.5 text-sm">
                <p className="font-semibold">{copy('postalStaffNotes')}</p>
                <p dir="auto" className="whitespace-pre-wrap wrap-anywhere">
                  {visible.postal.staff_notes}
                </p>
              </div>
            )}
            {!editable && visible.postal && (
              <>
                {visible.postal.courier && (
                  <p>
                    {copy('postalCourier')}: <bdi>{visible.postal.courier}</bdi>
                  </p>
                )}
                <SolarPostalTrackingSummary
                  key={`${requestId}:${revision}`}
                  tracking={{
                    postalStatus: visible.postal.status,
                    trackingNumber: visible.postal.tracking_number,
                    sendDate: visible.postal.send_date,
                    estimatedArrivalDate: visible.postal.estimated_arrival_date ?? null,
                    trackingUrl: visible.postal.tracking_url ?? null,
                    note: visible.postal.tracking_note ?? null,
                    recordedAt: visible.postal.tracking_recorded_at ?? null,
                  }}
                />
              </>
            )}
          </>
        )}
        {showForm && (
          <Form {...form}>
            <div className="space-y-3" role="group" aria-label={copy('postalShipment')}>
              <form className={recordEditorSurface} onSubmit={submit} noValidate>
                <div className="border-b bg-muted/25 px-4 py-3 sm:px-5">
                  <h3 className="text-sm font-semibold">{copy('postalShipment')}</h3>
                </div>
                <div className="space-y-3 px-4 py-4 sm:px-5">
                  {form.formState.errors.root && (
                    <Alert variant="destructive">
                      <AlertDescription>{copy('documentValidationUnavailable')}</AlertDescription>
                    </Alert>
                  )}
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    {(
                      [
                        ['courier', 'solar-postal-courier', 'postalCourier', 'postalCourierHelp'],
                        [
                          'trackingNumber',
                          'solar-postal-tracking-number',
                          'postalTracking',
                          'postalTrackingHelp',
                        ],
                        [
                          'sendDate',
                          'solar-postal-send-date',
                          'postalSendDate',
                          'postalSendDateHelp',
                        ],
                        [
                          'receiptImageId',
                          'solar-postal-receipt-image',
                          'postalReceipt',
                          'postalReceiptHelp',
                        ],
                      ] as const
                    ).map(([name, id, label, help]) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field, fieldState }) => (
                          <FormItem
                            id={id}
                            className={
                              name === 'receiptImageId'
                                ? 'min-w-0 border-t pt-3 sm:col-span-2'
                                : 'min-w-0'
                            }
                          >
                            <FormLabel>{copy(label)}</FormLabel>
                            {name === 'receiptImageId' ? (
                              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                                <FormControl>
                                  <NativeSelect
                                    {...field}
                                    disabled={sending || unconfirmed}
                                    className="w-full min-w-0 sm:flex-1"
                                    onChange={(event) => {
                                      ++editGeneration.current;
                                      field.onChange(event);
                                    }}
                                  >
                                    <option value="">{copy('postalNoReceipt')}</option>
                                    {selectableImages.map((image) => (
                                      <option key={image.id} value={image.id}>
                                        {image.originalName}
                                      </option>
                                    ))}
                                  </NativeSelect>
                                </FormControl>
                                {receiptView && (
                                  <Link
                                    to="/solar/requests/$requestId/shipment/upload-receipt"
                                    params={{ requestId }}
                                    className={buttonVariants({ variant: 'outline' })}
                                    disabled={sending || unconfirmed}
                                    onClick={(event) => {
                                      if (form.isSubmissionPending()) event.preventDefault();
                                    }}
                                  >
                                    {copy('postalUploadReceipt')}
                                  </Link>
                                )}
                              </div>
                            ) : name === 'sendDate' && locale === 'fa' ? (
                              <FormControl>
                                <ShipmentCalendar
                                  label={copy(label)}
                                  locale={locale}
                                  timezone="UTC"
                                  value={datePickerCalendarDate(field.value, 'UTC')}
                                  maxDate={datePickerCalendarDate(today, 'UTC')}
                                  showYearSelect
                                  compactLabel
                                  className="min-h-11"
                                  disabled={sending || unconfirmed}
                                  triggerProps={{
                                    name: field.name,
                                    ref: field.ref,
                                    'aria-required': true,
                                  }}
                                  onBlur={field.onBlur}
                                  onChange={(date) => {
                                    ++editGeneration.current;
                                    // The Jalali picker returns the selected day at browser-local midnight.
                                    field.onChange(
                                      date
                                        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                                        : ''
                                    );
                                  }}
                                />
                              </FormControl>
                            ) : (
                              <FormControl>
                                <Input
                                  {...field}
                                  disabled={sending || unconfirmed}
                                  aria-required="true"
                                  type={name === 'sendDate' ? 'date' : 'text'}
                                  max={name === 'sendDate' ? today : undefined}
                                  dir={name === 'courier' ? 'auto' : 'ltr'}
                                  onChange={(event) => {
                                    ++editGeneration.current;
                                    field.onChange(event);
                                  }}
                                />
                              </FormControl>
                            )}
                            <CompactFieldFeedback
                              help={copy(help)}
                              validationMessage={messages[name]}
                              invalid={!!fieldState.error?.message}
                            />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  {imageStatus === 'loading' && (
                    <LoadingStatus>{copy('postalReceiptLoading')}</LoadingStatus>
                  )}
                  {imageStatus === 'ready' && selectableImages.length === 0 && (
                    <p role="status" className="text-sm text-muted-foreground">
                      {copy('postalReceiptEmpty')}
                    </p>
                  )}
                  {imageStatus === 'error' && (
                    <Alert variant="destructive">
                      <AlertDescription>{copy('postalReceiptLoadError')}</AlertDescription>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={sending}
                        onClick={() => setImageRevision((value) => value + 1)}
                      >
                        {copy('retry')}
                      </Button>
                    </Alert>
                  )}
                </div>
                <RecordEditorActions className="max-sm:justify-start">
                  <Button type="submit" loading={sending} disabled={unconfirmed}>
                    {copy('postalSubmit')}
                  </Button>
                </RecordEditorActions>
              </form>
            </div>
          </Form>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {copy(unconfirmed ? 'postalShipmentUnconfirmed' : 'postalError')}
            </AlertDescription>
          </Alert>
        )}
        {loadError && <p role="alert">{copy('postalLoadError')}</p>}
      </section>
    </>
  );
}

function ShipmentReceiptEditor({
  requestId,
  profileId,
  siteAddress,
  available,
  loading,
  loadError,
  onRetry,
  onUploaded,
}: {
  requestId: string;
  profileId: string;
  siteAddress: string | null | undefined;
  available: boolean;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  onUploaded: (document: BusinessDocument) => void;
}) {
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const title = copy('postalUploadReceipt');
  const navigate = useNavigate();
  const shipment = {
    to: '/solar/requests/$requestId/shipment',
    params: { requestId },
  } as const;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active.contains(heading.current))
      heading.current?.focus({ preventScroll: true });
  }, [available]);

  return (
    <div className="min-w-0 space-y-3" data-slot="shipment-receipt" data-toast-anchor>
      <Link
        {...shipment}
        className="touch-action inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {copy('postalBackToShipment')}
      </Link>
      {available ? (
        <DocumentUpload
          staff={false}
          profileId={profileId}
          replacement={null}
          imageOnly
          association={{ businessRecordType: 'solar_request', businessRecordId: requestId }}
          recordPage
          recordTitle={title}
          recordHeadingRef={heading}
          recordContext={
            <>
              {siteAddress && (
                <dl className="mt-3 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
                  <dt className="text-xs text-muted-foreground">{copy('address')}</dt>
                  <dd dir="auto" className="mt-1 font-medium wrap-anywhere">
                    {siteAddress}
                  </dd>
                </dl>
              )}
              <p className="mt-2 text-sm text-muted-foreground">
                {copy('postalReceiptUploadHelp')}
              </p>
            </>
          }
          onClose={() => void navigate(shipment)}
          onUploaded={(document) => {
            onUploaded(document);
            void navigate({ ...shipment, replace: true });
          }}
        />
      ) : (
        <>
          <h1
            ref={heading}
            data-slot="editor-heading"
            tabIndex={-1}
            className="text-2xl font-semibold outline-none!"
          >
            {title}
          </h1>
          {loading ? (
            <LoadingStatus>{copy('loading')}</LoadingStatus>
          ) : (
            <Alert variant="destructive">
              <AlertDescription>
                {copy(loadError ? 'postalLoadError' : 'shipmentPageUnavailable')}
              </AlertDescription>
              {loadError && (
                <Button variant="outline" onClick={onRetry}>
                  {copy('retry')}
                </Button>
              )}
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
