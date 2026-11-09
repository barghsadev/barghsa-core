import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { documentUrl, DocumentRequestError } from '../lib/documents.js';
import { useEffect, useState } from 'react';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { LoadingStatus, Button } from '@barghsa/ui';

type LegalDocumentLink = { key: string; name: string; url: string };

export function LegalProfileDocuments(props: Parameters<typeof OwnedLegalProfileDocuments>[0]) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedLegalProfileDocuments
      key={JSON.stringify([actor, revision, props.profileId])}
      {...props}
    />
  );
}
function OwnedLegalProfileDocuments({
  profileId,
  disabled = false,
  canInteract = () => true,
  onAccessDenied,
}: {
  profileId: string;
  disabled?: boolean;
  canInteract?: () => boolean;
  onAccessDenied?: () => void;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readDocument = useOwnedDocumentRead(
    actor,
    revision,
    false,
    profileId,
    'legal-profile-documents'
  );
  const locale = useLocale();
  const [documents, setDocuments] = useState<LegalDocumentLink[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDocuments([]);
    setStatus('loading');
    readDocument(
      `/api/onboarding/documents/${encodeURIComponent(profileId)}`,
      {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      },
      async (path, options) => {
        const response = await fetch(path, options);
        if (!response.ok) throw new DocumentRequestError(response.status, null);
        const body = (await response.json()) as { documents?: unknown } | null;
        if (!Array.isArray(body?.documents)) throw new Error('Invalid legal documents');
        return body.documents.map((row: unknown) => {
          const document = row as Partial<LegalDocumentLink> | null;
          if (!document || typeof document.key !== 'string' || typeof document.name !== 'string')
            throw new Error('Invalid legal document');
          return { key: document.key, name: document.name, url: documentUrl(document.url) };
        });
      }
    )
      .then((links) => {
        if (!controller.signal.aborted) {
          setDocuments(links);
          setStatus('ready');
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DocumentRequestError && [401, 403, 404].includes(error.status))
          onAccessDenied?.();
        setStatus('error');
      });
    return () => controller.abort();
  }, [profileId, retry, readDocument]);
  return (
    <section
      className="rounded-lg border p-4 space-y-3"
      aria-label={t('onboarding.documents.title', locale)}
    >
      <h2 className="text-base font-semibold">{t('onboarding.documents.title', locale)}</h2>
      {status === 'loading' ? (
        <LoadingStatus>{t('onboarding.draft.loading', locale)}</LoadingStatus>
      ) : status === 'error' ? (
        <p role="alert">{t('onboarding.documents.loadError', locale)}</p>
      ) : documents.length ? (
        <ul>
          {documents.map((document) => (
            <li key={document.key}>
              <a
                className="underline"
                href={document.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                {document.name}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p role="status">{t('onboarding.documents.empty', locale)}</p>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          if (canInteract()) setRetry((value) => value + 1);
        }}
        disabled={disabled || status === 'loading'}
      >
        {t('onboarding.documents.refresh', locale)}
      </Button>
    </section>
  );
}
