import { useEffect, useState, type FormEvent } from 'react';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import { DocumentDetail } from '../components/DocumentDetail.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { SolarContractForm } from '../components/SolarContractForm.js';

interface Guidance {
  fa: string;
  en: string;
  destinationAddress: string;
  contactDetails: string;
  originals: Array<{ fa: string; en: string }>;
}
interface Row {
  id: string;
  profile_id: string;
  request_status: string;
  postal_status: string;
  courier: string | null;
  tracking_number: string | null;
  send_date: string | null;
  receipt_image_id: string | null;
  staff_notes: string | null;
}

export function AdminSolarPostalPage() {
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const [rows, setRows] = useState<Row[]>([]);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [originalsFa, setOriginalsFa] = useState('');
  const [originalsEn, setOriginalsEn] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [createdContractId, setCreatedContractId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/admin/solar/postal-queue', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('queue');
        return response.json() as Promise<{ requests: Row[] }>;
      })
      .then((value) => {
        if (!controller.signal.aborted) setRows(value.requests);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/admin/solar/postal-guidance', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('guidance');
        return response.json() as Promise<Guidance>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        setGuidance(value);
        setOriginalsFa(value.originals.map((item) => item.fa).join('\n'));
        setOriginalsEn(value.originals.map((item) => item.en).join('\n'));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);
  const row = rows.find((item) => item.id === selected);
  function saveGuidance(event: FormEvent) {
    event.preventDefault();
    if (!guidance) return;
    const fa = originalsFa
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    const en = originalsEn
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!guidance.fa.trim() || !guidance.en.trim() || fa.length !== en.length) {
      setError(true);
      return;
    }
    setAction({
      title: copy('postalSaveGuidance'),
      description: copy('postalSaveGuidance'),
      path: '/api/admin/solar/postal-guidance',
      method: 'PUT',
      body: {
        ...guidance,
        fa: guidance.fa.trim(),
        en: guidance.en.trim(),
        originals: fa.map((item, index) => ({ fa: item, en: en[index] })),
      },
    });
  }
  function decide(decision: 'confirm-received' | 'mark-incomplete' | 'mark-not-received') {
    if (!row || (decision !== 'confirm-received' && !reason.trim())) {
      setError(true);
      return;
    }
    setAction({
      title: copy(`postal_${decision}`),
      description: row.tracking_number ?? row.id,
      path: `/api/admin/solar/requests/${row.id}/postal/${decision}`,
      method: 'POST',
      ...(decision !== 'confirm-received' ? { body: { reason: reason.trim() } } : {}),
    });
  }
  return (
    <main className="space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-3xl font-semibold">{copy('postalStaffTitle')}</h1>
      {error && <p role="alert">{copy('postalError')}</p>}
      {createdContractId && (
        <p role="status">
          {copy('solarContractCreated')}{' '}
          <a
            className="underline"
            href={`/admin/contracts?contractId=${encodeURIComponent(createdContractId)}`}
          >
            {copy('solarViewContract')}
          </a>
        </p>
      )}
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-xl font-semibold">{copy('postalStaffQueue')}</h2>
        {!rows.length && <p>{copy('postalStaffEmpty')}</p>}
        <ul className="space-y-2">
          {rows.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`w-full rounded-md border p-3 text-start ${selected === item.id ? 'border-primary' : ''}`}
                onClick={() => {
                  setSelected(item.id);
                  setPreview(null);
                  setReason('');
                }}
              >
                {item.id} · {copy(`postal_${item.postal_status}`)}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {row && (
        <section className="space-y-3 rounded-xl border p-5">
          <h2 className="text-xl font-semibold">{copy('postalShipment')}</h2>
          <p>
            {copy('postalStatus')}: {copy(`postal_${row.postal_status}`)}
          </p>
          {row.courier && (
            <p>
              {copy('postalCourier')}: {row.courier}
            </p>
          )}
          {row.tracking_number && (
            <p>
              {copy('postalTracking')}: <span dir="ltr">{row.tracking_number}</span>
            </p>
          )}
          {row.send_date && (
            <p>
              {copy('postalSendDate')}: {row.send_date.slice(0, 10)}
            </p>
          )}
          {row.staff_notes && (
            <p>
              {copy('postalStaffNotes')}: {row.staff_notes}
            </p>
          )}
          {row.receipt_image_id && (
            <button
              type="button"
              className="underline"
              onClick={() => setPreview(row.receipt_image_id)}
            >
              {copy('preview')}
            </button>
          )}
          {preview && (
            <DocumentDetail
              id={preview}
              staff
              onClose={() => setPreview(null)}
              onChanged={() => setRevision((value) => value + 1)}
              onPrevious={setPreview}
              onReplace={() => {}}
              allowReplacement={false}
            />
          )}
          {row.postal_status === 'shipped' && (
            <>
              <label className="block">
                {copy('reason')}
                <textarea
                  className="mt-1 w-full rounded-md border p-2"
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                  onClick={() => decide('confirm-received')}
                >
                  {copy('postal_confirm-received')}
                </button>
                <button
                  className="rounded-md border px-4 py-2"
                  onClick={() => decide('mark-incomplete')}
                >
                  {copy('postal_mark-incomplete')}
                </button>
                <button
                  className="rounded-md border px-4 py-2"
                  onClick={() => decide('mark-not-received')}
                >
                  {copy('postal_mark-not-received')}
                </button>
              </div>
            </>
          )}
          {['postal_documents_received', 'approved'].includes(row.request_status) && (
            <div className="space-y-3">
              <label className="block">
                {copy('reason')}
                <textarea
                  className="mt-1 w-full rounded-md border p-2"
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {row.request_status === 'postal_documents_received' && (
                  <button
                    type="button"
                    className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                    onClick={() =>
                      setAction({
                        title: copy('solarFinalApprove'),
                        description: row.id,
                        path: `/api/admin/solar/requests/${row.id}/final-approve`,
                        method: 'POST',
                      })
                    }
                  >
                    {copy('solarFinalApprove')}
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-md border px-4 py-2"
                  onClick={() => {
                    if (!reason.trim()) {
                      setError(true);
                      return;
                    }
                    setAction({
                      title: copy('solarCloseNoContract'),
                      description: row.id,
                      path: `/api/admin/solar/requests/${row.id}/close-no-contract`,
                      method: 'POST',
                      body: { reason: reason.trim() },
                    });
                  }}
                >
                  {copy('solarCloseNoContract')}
                </button>
              </div>
            </div>
          )}
          {row.request_status === 'approved' && (
            <SolarContractForm
              key={row.id}
              requestId={row.id}
              profileId={row.profile_id}
              onCreated={(contractId) => {
                setCreatedContractId(contractId);
                setSelected(null);
                setRevision((value) => value + 1);
              }}
            />
          )}
        </section>
      )}
      {guidance && (
        <form className="space-y-3 rounded-xl border p-5" onSubmit={saveGuidance}>
          <h2 className="text-xl font-semibold">{copy('postalGuidance')}</h2>
          {(['fa', 'en', 'destinationAddress', 'contactDetails'] as const).map((key) => (
            <label key={key} className="block">
              {copy(`postalGuidance_${key}`)}
              <textarea
                className="mt-1 w-full rounded-md border p-2"
                value={guidance[key]}
                onChange={(event) => setGuidance({ ...guidance, [key]: event.target.value })}
              />
            </label>
          ))}
          <label className="block">
            {copy('postalOriginalsFa')}
            <textarea
              className="mt-1 w-full rounded-md border p-2"
              value={originalsFa}
              onChange={(event) => setOriginalsFa(event.target.value)}
            />
          </label>
          <label className="block">
            {copy('postalOriginalsEn')}
            <textarea
              className="mt-1 w-full rounded-md border p-2"
              value={originalsEn}
              onChange={(event) => setOriginalsEn(event.target.value)}
            />
          </label>
          <button className="rounded-md border px-4 py-2" type="submit">
            {copy('postalSaveGuidance')}
          </button>
        </form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setError(false);
            setRevision((value) => value + 1);
            setReason('');
          }}
        />
      )}
    </main>
  );
}
