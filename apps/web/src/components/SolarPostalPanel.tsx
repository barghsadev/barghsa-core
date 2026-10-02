import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  const [courier, setCourier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [sendDate, setSendDate] = useState('');
  const [receiptImageId, setReceiptImageId] = useState('');
  const [upload, setUpload] = useState(false);
  const [revision, setRevision] = useState(0);
  const [imageRevision, setImageRevision] = useState(0);
  const [error, setError] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [acceptedRequest, setAcceptedRequest] = useState(requestId);
  const currentRequest = useRef(requestId);
  currentRequest.current = requestId;
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setError(false);
    setLoadError(false);
    setSending(false);
    setUpload(false);
    void fetch(`/api/solar/requests/${encodeURIComponent(requestId)}/postal`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('postal');
        return response.json() as Promise<State>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        setState(value);
        setAcceptedRequest(requestId);
        setCourier(value.postal?.courier ?? '');
        setTrackingNumber(value.postal?.tracking_number ?? '');
        setSendDate(value.postal?.send_date?.slice(0, 10) ?? '');
        setReceiptImageId(value.postal?.receipt_image_id ?? '');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState(null);
          setLoadError(true);
        }
      });
    return () => controller.abort();
  }, [requestId, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setImages([]);
    const params = new URLSearchParams({
      businessRecordType: 'solar_request',
      businessRecordId: requestId,
      profileId,
      category: 'image',
    });
    void documentRequest<DocumentPage>(`/api/documents?${params}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted)
          setImages(
            value.documents.filter(
              (document) => document.state === 'Available' && document.uploadedByType === 'customer'
            )
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [requestId, profileId, imageRevision]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/solar/requests/${encodeURIComponent(requestId)}/postal/shipment`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            courier,
            trackingNumber,
            sendDate,
            ...(receiptImageId ? { receiptImageId } : {}),
          }),
        }
      );
      if (currentRequest.current !== requestId) return;
      if (!response.ok) throw new Error('shipment');
      setRevision((value) => value + 1);
    } catch {
      if (currentRequest.current === requestId) setError(true);
    } finally {
      if (currentRequest.current === requestId) setSending(false);
    }
  }
  const visible = acceptedRequest === requestId ? state : null;
  const editable =
    visible?.requestStatus === 'waiting_for_postal_submission' &&
    ['waiting_for_shipment', 'incomplete', 'not_received'].includes(visible.postal?.status ?? '');
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
      {editable && (
        <form className="space-y-3" onSubmit={(event) => void submit(event)}>
          <label className="block">
            {copy('postalCourier')}
            <input
              className="mt-1 w-full rounded-md border p-2"
              required
              maxLength={100}
              value={courier}
              onChange={(event) => setCourier(event.target.value)}
            />
          </label>
          <label className="block">
            {copy('postalTracking')}
            <input
              className="mt-1 w-full rounded-md border p-2"
              required
              maxLength={200}
              dir="ltr"
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
            />
          </label>
          <label className="block">
            {copy('postalSendDate')}
            <input
              className="mt-1 w-full rounded-md border p-2"
              required
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={sendDate}
              onChange={(event) => setSendDate(event.target.value)}
            />
          </label>
          <label className="block">
            {copy('postalReceipt')}
            <select
              className="mt-1 w-full rounded-md border p-2"
              value={receiptImageId}
              onChange={(event) => setReceiptImageId(event.target.value)}
            >
              <option value="">{copy('postalNoReceipt')}</option>
              {images.map((image) => (
                <option key={image.id} value={image.id}>
                  {image.originalName}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="underline" onClick={() => setUpload((value) => !value)}>
            {copy('postalUploadReceipt')}
          </button>
          {upload && (
            <DocumentUpload
              staff={false}
              profileId={profileId}
              replacement={null}
              imageOnly
              association={{ businessRecordType: 'solar_request', businessRecordId: requestId }}
              onClose={() => setUpload(false)}
              onUploaded={(document) => {
                setUpload(false);
                setReceiptImageId(document.id);
                setImageRevision((value) => value + 1);
              }}
            />
          )}
          <div>
            <button
              className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
              disabled={sending}
              type="submit"
            >
              {copy('postalSubmit')}
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{copy('postalError')}</p>}
      {loadError && <p role="alert">{copy('postalLoadError')}</p>}
      <button
        type="button"
        className="underline"
        disabled={sending}
        onClick={() => setRevision((value) => value + 1)}
      >
        {copy('postalTrackingReload')}
      </button>
    </section>
  );
}
