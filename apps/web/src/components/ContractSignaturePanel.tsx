import { useEffect, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  NativeSelect,
  PageLoading,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { documentText } from '@barghsa/i18n/documents';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { contractBase, type ContractSignatureData } from '../lib/contracts.js';
import {
  documentBase,
  documentRequest,
  type BusinessDocument,
  type DocumentPage,
} from '../lib/documents.js';
import { ContractFinancialReviewDialog } from './ContractFinancialReviewDialog.js';
import { type TeamAction } from './TeamActionDialog.js';

function documentsPath(
  id: string,
  versionId: string,
  profileId: string,
  staff: boolean,
  before?: string
) {
  const query = new URLSearchParams({
    businessRecordType: 'contract',
    businessRecordId: id,
    contractVersionId: versionId,
    state: 'Approved',
    limit: '100',
  });
  if (staff) query.set('profileId', profileId);
  if (before) query.set('before', before);
  return `${documentBase(staff)}?${query}`;
}
export function ContractSignaturePanel({
  id,
  versionId,
  profileId,
  staff,
  onChanged,
  onStatus,
}: {
  id: string;
  versionId: string;
  profileId: string;
  staff: boolean;
  onChanged: () => void;
  onStatus?: (data: ContractSignatureData | null) => void;
}) {
  const locale = useLocale(),
    time = useAccountTime();
  const word = (key: string) => contractText(key, locale);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<ContractSignatureData | null>(null);
  const [documents, setDocuments] = useState<BusinessDocument[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [original, setOriginal] = useState('');
  const [signed, setSigned] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setController(abort);
    setData(null);
    onStatus?.(null);
    setDocuments([]);
    setNext(null);
    setBusy(false);
    setError(false);
    setMoreError(false);
    setOriginal('');
    setSigned('');
    setAcknowledged(false);
    setAction(null);
    void documentRequest<ContractSignatureData>(
      `${contractBase(staff)}/${id}/signature?versionId=${encodeURIComponent(versionId)}`,
      { signal: abort.signal }
    )
      .then(async (view) => {
        const page =
          view.canRequest || view.canRecord
            ? await documentRequest<DocumentPage>(documentsPath(id, versionId, profileId, staff), {
                signal: abort.signal,
              })
            : { documents: [], nextBefore: null };
        if (!abort.signal.aborted) {
          setData(view);
          onStatus?.(view);
          setDocuments(page.documents);
          setNext(page.nextBefore);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setError(true);
          onStatus?.(null);
        }
      });
    return () => abort.abort();
  }, [id, versionId, profileId, staff, reload, onStatus]);
  async function more() {
    if (!next || !controller || busy) return;
    setBusy(true);
    setMoreError(false);
    try {
      const page = await documentRequest<DocumentPage>(
        documentsPath(id, versionId, profileId, staff, next),
        { signal: controller.signal }
      );
      if (!controller.signal.aborted) {
        setDocuments((previous) => [
          ...previous,
          ...page.documents.filter((item) => !previous.some((old) => old.id === item.id)),
        ]);
        setNext(page.nextBefore);
      }
    } catch {
      if (!controller.signal.aborted) setMoreError(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function choose(request: boolean) {
    if (!data) return;
    setAction({
      title: word(request ? 'prepareSignature' : 'recordSignature'),
      description: `${word('signatureNotice')} ${documents.find((item) => item.id === (request ? original : signed))?.originalName}`,
      path: `${contractBase(staff)}/${id}/${request ? 'signature-request' : 'signature'}`,
      method: 'POST',
      body: {
        expectedVersionId: versionId,
        idempotencyKey: crypto.randomUUID(),
        ...(request
          ? { originalDocumentId: original, expectedRequestId: data.request?.id ?? null }
          : { signedDocumentId: signed, requestId: data.request?.id }),
      },
      conflictMessage: word('signatureConflict'),
      forbiddenMessage: word('denied'),
    });
  }
  const eligible = documents.filter(
    (item) =>
      item.state === 'Approved' &&
      item.businessRecordId === id &&
      item.contractVersionId === versionId
  );
  return (
    <section
      id="contract-signature"
      className="flex flex-col gap-4 rounded-lg border p-4"
      aria-label={word('signatureTitle')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{word('signatureTitle')}</h3>
        <Button variant="ghost" onClick={() => setReload((value) => value + 1)}>
          {word('refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{word('signatureNotice')}</p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : !data ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {data.request ? (
            <div>
              <p>
                {word('signatureRequest')} {data.request.requestNumber.toLocaleString(locale)}:{' '}
                {data.request.originalName}
              </p>
              <p className="text-sm">
                {time.format(data.request.requestedAt)}:{' '}
                {documentText(data.request.documentState, locale)}
              </p>
            </div>
          ) : (
            <p>{word('noSignatureRequest')}</p>
          )}
          {data.signature ? (
            <div role="status">
              <p>
                {word('signatureRecorded')}: {data.signature.originalName}
              </p>
              <p>{time.format(data.signature.recordedAt)}</p>
              <p>
                {word('recordedBy')}: {word(data.signature.recordedByType)}
              </p>
              <p>
                {word('uploadedBy')}: {word(data.signature.uploadedByType)}
              </p>
            </div>
          ) : null}
          {data.canRequest ? (
            <>
              <Field>
                <FieldLabel htmlFor="signature-original">{word('approvedOriginal')}</FieldLabel>
                <NativeSelect
                  id="signature-original"
                  value={original}
                  onChange={(event) => setOriginal(event.target.value)}
                >
                  <option value="">{word('selectDocument')}</option>
                  {eligible
                    .filter(
                      (item) =>
                        item.contractRole === (data.isAmendment ? 'amendment' : 'original') &&
                        item.detectedMime === 'application/pdf'
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.originalName}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Button className="self-start" disabled={!original} onClick={() => choose(true)}>
                {word('prepareSignature')}
              </Button>
            </>
          ) : null}
          {data.canRecord ? (
            <>
              <Field>
                <FieldLabel htmlFor="signature-signed">{word('approvedSigned')}</FieldLabel>
                <NativeSelect
                  id="signature-signed"
                  value={signed}
                  onChange={(event) => {
                    setSigned(event.target.value);
                    setAcknowledged(false);
                  }}
                >
                  <option value="">{word('selectDocument')}</option>
                  {eligible
                    .filter((item) => item.contractRole === 'signed')
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.originalName}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                {word('signatureAcknowledgement')}
              </label>
              <Button
                className="self-start"
                disabled={!signed || !acknowledged}
                onClick={() => choose(false)}
              >
                {word('recordSignature')}
              </Button>
            </>
          ) : null}
          {data.canRequest || data.canRecord ? (
            <p className="text-sm text-muted-foreground">{word('signatureDocumentHint')}</p>
          ) : null}
          {moreError ? <p role="alert">{word('error')}</p> : null}
          {next ? (
            <Button variant="outline" disabled={busy} onClick={() => void more()}>
              {word('next')}
            </Button>
          ) : null}
        </>
      )}
      {action ? (
        <ContractFinancialReviewDialog
          action={action}
          profileId={profileId}
          contractId={id}
          time={time}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            setReload((value) => value + 1);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
