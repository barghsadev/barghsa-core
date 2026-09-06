import { useEffect, useState } from 'react';
import { t } from '@barghsa/i18n';
import { useLocale } from '../hooks/useLocale.js';
import { Button } from '@barghsa/ui';

export function LegalProfileDocuments({ profileId }: { profileId: string }) {
  const locale = useLocale();
  const [documents, setDocuments] = useState<Array<{ key: string; name: string; url: string }>>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDocuments([]);
    setStatus('loading');
    fetch(`/api/onboarding/documents/${profileId}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Documents unavailable');
        return response.json() as Promise<{
          documents: Array<{ key: string; name: string; url: string }>;
        }>;
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setDocuments(body.documents);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [profileId, retry]);
  return (
    <section
      className="rounded-lg border p-4 space-y-3"
      aria-label={t('onboarding.documents.title', locale)}
    >
      <h2 className="text-base font-semibold">{t('onboarding.documents.title', locale)}</h2>
      {status === 'loading' ? (
        <p role="status">{t('onboarding.draft.loading', locale)}</p>
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
              >
                {document.name}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('onboarding.documents.empty', locale)}</p>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => setRetry((value) => value + 1)}
        disabled={status === 'loading'}
      >
        {t('onboarding.documents.refresh', locale)}
      </Button>
    </section>
  );
}
