import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, AlertDescription, Button, Input } from '@barghsa/ui';
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

export function SolarPostalPanel({
  requestId,
  profileId,
}: {
  requestId: string;
  profileId: string;
}) {
  const locale = useLocale();
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
  const [imageError, setImageError] = useState(false);
  const pendingShipment = useRef<{ scope: string; body: ShipmentBody } | null>(null);
  const [upload, setUpload] = useState(false);
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
    setUpload(false);
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
    setUpload(false);
    void fetch(`/api/solar/requests/${encodeURIComponent(requestId)}/postal`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('postal');
        return postalState(await response.json());
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
  }, [scope, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setImages([]);
    setImageError(false);
    const capturedGeneration = generation.current;
    const params = new URLSearchParams({
      businessRecordType: 'solar_request',
      businessRecordId: requestId,
      profileId,
      category: 'image',
    });
    void documentRequest<DocumentPage>(`/api/documents?${params}`, { signal: controller.signal })
      .then((value) => {
        if (
          !controller.signal.aborted &&
          capturedGeneration === generation.current &&
          !postalUnavailable.current
        )
          setImages(
            value.documents.filter(
              (document) => document.state === 'Available' && document.uploadedByType === 'customer'
            )
          );
      })
      .catch(() => {
        if (!controller.signal.aborted && capturedGeneration === generation.current)
          setImageError(true);
      });
    return () => controller.abort();
  }, [requestId, profileId, imageRevision]);
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
        const read = await fetch(`/api/solar/requests/${encodeURIComponent(requestId)}/postal`, {
          credentials: 'include',
        });
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
          saved = postalState(await read.json());
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
  return (
    <section className="space-y-4 rounded-xl border p-5" aria-label={copy('postalStage')}>
      <h2 className="text-xl font-semibold">{copy('postalStage')}</h2>
      {!visible && !loadError && <p role="status">{copy('loading')}</p>}
      {visible && (
        <>
          <p>{visible.guidance[locale]}</p>
          {visible.guidance.destinationAddress && (
            <p>
              <strong>{copy('postalDestination')}:</strong> {visible.guidance.destinationAddress}
            </p>
          )}
          {visible.guidance.contactDetails && (
            <p>
              <strong>{copy('postalContact')}:</strong> {visible.guidance.contactDetails}
            </p>
          )}
          {!!visible.guidance.originals.length && (
            <>
              <h3 className="font-medium">{copy('postalOriginals')}</h3>
              <ul className="list-inside list-disc">
                {visible.guidance.originals.map((item, index) => (
                  <li key={index}>{item[locale]}</li>
                ))}
              </ul>
            </>
          )}
          <p role="status">
            {copy('postalStatus')}:{' '}
            {copy(`postal_${visible.postal?.status ?? 'waiting_for_shipment'}`)}
          </p>
          {visible.postal?.staff_notes && (
            <p role="alert">
              {copy('postalStaffNotes')}: {visible.postal.staff_notes}
            </p>
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
          <div role="group" aria-label={copy('postalShipment')}>
            <form className="space-y-3" onSubmit={submit} noValidate>
              {form.formState.errors.root && (
                <Alert variant="destructive">
                  <AlertDescription>{copy('documentValidationUnavailable')}</AlertDescription>
                </Alert>
              )}
              {(
                [
                  ['courier', 'solar-postal-courier', 'postalCourier', 'postalCourierHelp'],
                  [
                    'trackingNumber',
                    'solar-postal-tracking-number',
                    'postalTracking',
                    'postalTrackingHelp',
                  ],
                  ['sendDate', 'solar-postal-send-date', 'postalSendDate', 'postalSendDateHelp'],
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
                  render={({ field }) => (
                    <FormItem id={id}>
                      <FormLabel>{copy(label)}</FormLabel>
                      <FormControl>
                        {name === 'receiptImageId' ? (
                          <select
                            {...field}
                            disabled={sending || unconfirmed}
                            className="w-full rounded-md border bg-background p-2"
                            onChange={(event) => {
                              ++editGeneration.current;
                              field.onChange(event);
                            }}
                          >
                            <option value="">{copy('postalNoReceipt')}</option>
                            {images.map((image) => (
                              <option key={image.id} value={image.id}>
                                {image.originalName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            {...field}
                            disabled={sending || unconfirmed}
                            type={name === 'sendDate' ? 'date' : 'text'}
                            dir={name === 'trackingNumber' ? 'ltr' : undefined}
                            onChange={(event) => {
                              ++editGeneration.current;
                              field.onChange(event);
                            }}
                          />
                        )}
                      </FormControl>
                      <FormDescription>{copy(help)}</FormDescription>
                      <div className="grid">
                        <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
                          {messages[name]}
                        </p>
                        <FormMessage className="col-start-1 row-start-1" />
                      </div>
                    </FormItem>
                  )}
                />
              ))}
              <Button
                type="button"
                variant="link"
                disabled={sending || unconfirmed}
                onClick={() => setUpload((value) => !value)}
              >
                {copy('postalUploadReceipt')}
              </Button>
              {upload && (
                <DocumentUpload
                  staff={false}
                  profileId={profileId}
                  replacement={null}
                  imageOnly
                  association={{ businessRecordType: 'solar_request', businessRecordId: requestId }}
                  onClose={() => {
                    if (uploadGeneration === generation.current) setUpload(false);
                  }}
                  onUploaded={(document) => {
                    if (uploadGeneration !== generation.current) return;
                    setUpload(false);
                    ++editGeneration.current;
                    form.setValue('receiptImageId', document.id, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                    setImageRevision((value) => value + 1);
                  }}
                />
              )}
              <Button type="submit" loading={sending} disabled={unconfirmed}>
                {copy('postalSubmit')}
              </Button>
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
      {imageError && (
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
      {loadError && <p role="alert">{copy('postalLoadError')}</p>}
      <button
        type="button"
        className="underline"
        disabled={sending}
        onClick={() => {
          if (!form.isSubmissionPending()) setRevision((value) => value + 1);
        }}
      >
        {copy('postalTrackingReload')}
      </button>
    </section>
  );
}
