import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import { DocumentDetail } from '../components/DocumentDetail.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';

interface RequestRow {
  id: string;
  profile_id: string;
  status: string;
  building_type: string;
  document_count: number;
}
interface DocumentRow {
  id: string;
  document_id: string;
  file_name: string;
  staff_status: string;
  staff_reason: string | null;
  uploaded_by: string;
  uploaded_at: string;
  state: string;
  revision: number;
}
interface Detail {
  request: RequestRow;
  documents: DocumentRow[];
  requestedDocuments: Array<{ id: string; description: string }>;
}
interface Guidance {
  fa: string;
  en: string;
  suggestions: Array<{ fa: string; en: string }>;
}

export function AdminSolarDocumentsPage() {
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [fa, setFa] = useState(''),
    [en, setEn] = useState('');
  const [faSuggestions, setFaSuggestions] = useState(''),
    [enSuggestions, setEnSuggestions] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void fetch('/api/admin/solar/requests', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('queue');
        return response.json() as Promise<{ requests: RequestRow[] }>;
      })
      .then((result) => {
        if (!controller.signal.aborted) setRequests(result.requests);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/admin/solar/requests/${selected}/documents`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('details');
        return response.json() as Promise<Detail>;
      })
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [selected, revision]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/admin/solar/document-guidance', {
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
        setFa(value.fa);
        setEn(value.en);
        setFaSuggestions(value.suggestions.map((item) => item.fa).join('\n'));
        setEnSuggestions(value.suggestions.map((item) => item.en).join('\n'));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);
  function saveGuidance(event: FormEvent) {
    event.preventDefault();
    const persian = faSuggestions
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    const english = enSuggestions
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!fa.trim() || !en.trim() || persian.length !== english.length) {
      setError(true);
      return;
    }
    setAction({
      title: copy('saveGuidance'),
      description: copy('saveGuidance'),
      path: '/api/admin/solar/document-guidance',
      method: 'PUT',
      body: {
        fa: fa.trim(),
        en: en.trim(),
        suggestions: persian.map((item, index) => ({ fa: item, en: english[index] })),
      },
    });
  }
  function review(document: DocumentRow, decision: 'approve' | 'reject') {
    if (decision === 'reject' && !reason.trim()) return;
    setAction({
      title: copy(decision),
      description: document.file_name,
      path: `/api/admin/solar/requests/${selected}/documents/${document.document_id}/${decision}`,
      method: 'POST',
      body: {
        expectedRevision: document.revision,
        ...(decision === 'reject' ? { reason: reason.trim() } : {}),
      },
    });
  }
  return (
    <main className="space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-3xl font-semibold">{copy('staffTitle')}</h1>
      {error && <p role="alert">{copy('documentError')}</p>}
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-xl font-semibold">{copy('staffQueue')}</h2>
        {!requests.length && <p>{copy('staffEmpty')}</p>}
        <ul className="space-y-2">
          {requests.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className={`w-full rounded-md border p-3 text-start ${selected === row.id ? 'border-primary' : ''}`}
                onClick={() => {
                  setSelected(row.id);
                  setPreview(null);
                }}
              >
                {copy(row.building_type === 'non_household' ? 'nonHousehold' : 'building')} ·{' '}
                {row.status} · {row.document_count}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {detail && selected && (
        <section className="space-y-4 rounded-xl border p-5">
          <h2 className="text-xl font-semibold">{copy('staffDocuments')}</h2>
          <p>
            {copy('status')}: {detail.request.status}
          </p>
          <ul className="space-y-3">
            {detail.documents.map((document) => (
              <li key={document.id} className="rounded-md border p-3">
                <p className="font-medium">{document.file_name}</p>
                <p className="text-sm text-muted-foreground">
                  {document.uploaded_by} ·{' '}
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(document.uploaded_at))}{' '}
                  · {document.state} · {document.staff_status}
                </p>
                {document.staff_reason && <p>{document.staff_reason}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setPreview(document.document_id)}>
                    {copy('preview')}
                  </Button>
                  {['Available', 'SubmittedForReview'].includes(document.state) &&
                    ['documents_under_review', 'changes_requested'].includes(
                      detail.request.status
                    ) && (
                      <>
                        <Button variant="outline" onClick={() => review(document, 'approve')}>
                          {copy('approve')}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => review(document, 'reject')}
                          disabled={!reason.trim()}
                        >
                          {copy('reject')}
                        </Button>
                      </>
                    )}
                </div>
              </li>
            ))}
          </ul>
          {preview && (
            <DocumentDetail
              id={preview}
              staff
              onClose={() => setPreview(null)}
              onPrevious={setPreview}
              onChanged={refresh}
              onReplace={() => {}}
              allowReplacement={false}
            />
          )}
          <div>
            <Label htmlFor="solar-review-reason">{copy('reason')}</Label>
            <Input
              id="solar-review-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!reason.trim()}
              onClick={() =>
                setAction({
                  title: copy('requestAdditional'),
                  description: reason.trim(),
                  method: 'POST',
                  path: `/api/admin/solar/requests/${selected}/documents/request-additional`,
                  body: { description: reason.trim() },
                })
              }
            >
              {copy('requestAdditional')}
            </Button>
            <Button
              onClick={() =>
                setAction({
                  title: copy('advancePostal'),
                  description: copy('advancePostal'),
                  method: 'POST',
                  path: `/api/admin/solar/requests/${selected}/documents/advance`,
                })
              }
            >
              {copy('advancePostal')}
            </Button>
          </div>
        </section>
      )}
      {guidance && (
        <form className="space-y-3 rounded-xl border p-5" onSubmit={saveGuidance}>
          <h2 className="text-xl font-semibold">{copy('documentGuidance')}</h2>
          {(
            [
              [copy('guidanceFa'), fa, setFa],
              [copy('guidanceEn'), en, setEn],
              [copy('suggestionsFa'), faSuggestions, setFaSuggestions],
              [copy('suggestionsEn'), enSuggestions, setEnSuggestions],
            ] as const
          ).map(([label, value, setter]) => (
            <label key={label} className="block space-y-1">
              <span>{label}</span>
              <textarea
                className="min-h-24 w-full rounded-md border bg-background p-2"
                value={value}
                onChange={(e) => setter(e.target.value)}
              />
            </label>
          ))}
          <Button type="submit">{copy('saveGuidance')}</Button>
        </form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            setReason('');
            setPreview(null);
            refresh();
          }}
        />
      )}
    </main>
  );
}
