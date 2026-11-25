import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Alert, AlertDescription, Button, PageLoading } from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { DocumentDetail } from '../components/DocumentDetail.js';
import type { DocumentHoldPage } from '../components/DocumentLegalHolds.js';
import { DocumentUpload } from '../components/DocumentUpload.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useCustomerDocumentProfile } from '../hooks/useCustomerDocumentProfile.js';
import { useLocale } from '../hooks/useLocale.js';
import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { canReplaceDocument, validDocumentDetail } from '../lib/document-records.js';
import {
  documentBase,
  DocumentRequestError,
  type BusinessDocument,
  type DocumentAction,
} from '../lib/documents.js';
import { useProfileContextReset, useProfileContextRevision } from '../lib/profile-context.js';

type Entry =
  | { mode: 'upload' }
  | { mode: 'record' | 'replace'; documentId: string }
  | { mode: 'decision'; documentId: string; decision: DocumentAction }
  | { mode: 'holds'; documentId: string; page: DocumentHoldPage };

const documentParams = (documentId: string) => ({
  documentId,
  section: undefined,
  action: undefined,
  holdId: undefined,
  operation: undefined,
});

export default function DocumentRecordPage({
  entry,
  search,
  staff = false,
}: {
  entry: Entry;
  search: Record<string, unknown>;
  staff?: boolean;
}) {
  const profile = useCustomerDocumentProfile(!staff);
  const staffProfileId = typeof search.profileId === 'string' ? search.profileId : '';
  const id = staff ? staffProfileId : profile.id;
  const { state, retry } = profile;
  const queueRoute = staff ? '/admin/documents' : '/documents';
  const recordRoute = staff
    ? '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}'
    : '/documents/$documentId/{-$operation}';
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const navigate = useNavigate();
  useProfileContextReset(() => {
    if (staff) return;
    void navigate({
      to: '/documents',
      search: { ...search, cursor: undefined },
      replace: true,
      ignoreBlocker: true,
    });
  });
  const replacementId = entry.mode === 'replace' ? entry.documentId : null;
  const holdDocumentId = entry.mode === 'holds' ? entry.documentId : null;
  const documentBackId =
    replacementId ?? holdDocumentId ?? (entry.mode === 'decision' ? entry.documentId : null);
  const holdEditor = entry.mode === 'holds' && entry.page !== 'history';
  const back = () =>
    replacementId
      ? navigate({
          to: recordRoute,
          params: documentParams(replacementId),
          search,
          replace: true,
        })
      : navigate({ to: queueRoute, search, replace: true });
  function uploaded(document: BusinessDocument) {
    void navigate({
      to: recordRoute,
      params: documentParams(document.id),
      search: { ...search, cursor: undefined },
      replace: true,
    });
  }
  const scope = JSON.stringify([actor, revision, id]);

  return (
    <div
      className={`mx-auto min-w-0 space-y-3 ${entry.mode === 'record' ? 'max-w-5xl' : 'max-w-2xl'}`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {holdEditor && holdDocumentId ? (
        <Link
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
          to="/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}"
          params={{
            documentId: holdDocumentId,
            section: 'holds',
            action: undefined,
            holdId: undefined,
          }}
          search={search}
        >
          {word('backToHolds')}
        </Link>
      ) : documentBackId ? (
        <Link
          className="touch-action inline-flex items-center text-sm text-primary underline"
          to={recordRoute}
          activeOptions={{ exact: true }}
          params={documentParams(documentBackId)}
          search={search}
        >
          {word('backToDocument')}
        </Link>
      ) : (
        <Link
          className="touch-action inline-flex items-center text-sm text-primary underline"
          to={queueRoute}
          search={search}
        >
          {word('backToDocuments')}
        </Link>
      )}
      {!staff && state === 'loading' ? (
        <PageLoading label={word('loading')} />
      ) : !staff && !id ? (
        <Alert variant="destructive">
          <AlertDescription>
            {word(
              state === 'missing'
                ? 'activeProfileRequired'
                : state === 'denied'
                  ? 'denied'
                  : 'listError'
            )}
          </AlertDescription>
          {state === 'error' && (
            <Button variant="outline" onClick={retry}>
              {word('retry')}
            </Button>
          )}
        </Alert>
      ) : entry.mode === 'record' || entry.mode === 'holds' || entry.mode === 'decision' ? (
        <DocumentDetail
          id={entry.documentId}
          profileId={id ?? ''}
          staff={staff}
          showRetention={staff}
          holdPage={entry.mode === 'holds' ? entry.page : undefined}
          decision={entry.mode === 'decision' ? entry.decision : undefined}
          recordSearch={search}
        />
      ) : entry.mode === 'replace' ? (
        <ReplacementForm
          key={JSON.stringify([scope, entry.documentId])}
          profileId={id ?? ''}
          staff={staff}
          documentId={entry.documentId}
          onClose={() => void back()}
          onUploaded={uploaded}
        />
      ) : id ? (
        <DocumentUpload
          key={scope}
          staff={staff}
          profileId={id}
          replacement={null}
          recordPage
          onClose={() => void back()}
          onUploaded={uploaded}
        />
      ) : (
        <Alert>
          <AlertDescription>{word('selectProfile')}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ReplacementForm({
  profileId,
  staff,
  documentId,
  onClose,
  onUploaded,
}: {
  profileId: string;
  staff: boolean;
  documentId: string;
  onClose: () => void;
  onUploaded: (document: BusinessDocument) => void;
}) {
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const read = useOwnedDocumentRead(actor, revision, staff, profileId, documentId);
  const [replacement, setReplacement] = useState<BusinessDocument | null>(null);
  const [error, setError] = useState<'denied' | 'error' | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setReplacement(null);
    void read<unknown>(`${documentBase(staff)}/${encodeURIComponent(documentId)}`, {
      signal: controller.signal,
    })
      .then((document) => {
        if (controller.signal.aborted) return;
        if (!validDocumentDetail(document, documentId, profileId))
          throw new Error('Invalid document');
        if (canReplaceDocument(document, staff)) setReplacement(document);
        else setError('denied');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        const denied =
          reason instanceof DocumentRequestError && [401, 403, 404].includes(reason.status);
        setError(denied ? 'denied' : 'error');
      });
    return () => controller.abort();
  }, [attempt, documentId, profileId, read, staff]);

  if (replacement)
    return (
      <DocumentUpload
        staff={staff}
        profileId={replacement.profileId}
        replacement={replacement}
        recordPage
        onClose={onClose}
        onUploaded={onUploaded}
      />
    );
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h1 className="text-2xl font-semibold">{word('replace')}</h1>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word(error)}</AlertDescription>
          {error === 'error' && (
            <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              {word('retry')}
            </Button>
          )}
        </Alert>
      ) : (
        <PageLoading label={word('loading')} />
      )}
    </section>
  );
}
