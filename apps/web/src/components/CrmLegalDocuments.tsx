import { useEffect, useRef, useState } from 'react';
import { Button } from '@barghsa/ui';
import { t } from '@barghsa/i18n/crm';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

type DocumentLink = { name: string | null; url: string };
function validLink(value: unknown): value is DocumentLink {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<DocumentLink>;
  if (!(doc.name === null || typeof doc.name === 'string') || typeof doc.url !== 'string')
    return false;
  try {
    const url = new URL(doc.url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function CrmLegalDocuments({ profileId, canRead }: { profileId: string; canRead: boolean }) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [documents, setDocuments] = useState<DocumentLink[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function load() {
    if (request.current) return;
    const abort = new AbortController();
    request.current = abort;
    setLoading(true);
    setError(false);
    setDocuments(null);
    try {
      const response = await fetch('/api/crm/profiles/' + profileId + '/documents', {
        credentials: 'include',
        cache: 'no-store',
        signal: abort.signal,
      });
      if (!response.ok) throw new Error('Document request failed');
      const body: unknown = await response.json();
      const result = body as { profileId?: unknown; documents?: unknown } | null;
      if (
        !result ||
        result.profileId !== profileId ||
        !Array.isArray(result.documents) ||
        result.documents.length > 5 ||
        !result.documents.every(validLink)
      )
        throw new Error('Invalid document response');
      if (!abort.signal.aborted) setDocuments(result.documents);
    } catch {
      if (!abort.signal.aborted) setError(true);
    } finally {
      if (!abort.signal.aborted) {
        setLoading(false);
        request.current = null;
      }
    }
  }

  if (!canRead)
    return <p className="text-sm text-muted-foreground">{t('crm.documents.restricted', locale)}</p>;
  return (
    <div className="space-y-3 md:col-span-2 lg:col-span-3" aria-busy={loading}>
      <p className="text-sm text-muted-foreground">{t('crm.documents.expiry', locale)}</p>
      <Button type="button" onClick={() => void load()} disabled={loading}>
        {t(
          loading
            ? 'crm.documents.loading'
            : error
              ? 'crm.documents.retry'
              : documents
                ? 'crm.documents.refresh'
                : 'crm.documents.load',
          locale
        )}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('crm.documents.error', locale)}
        </p>
      )}
      {documents?.length === 0 && <p role="status">{t('crm.documents.empty', locale)}</p>}
      {documents && documents.length > 0 && (
        <ul className="space-y-2">
          {documents.map((document, index) => (
            <li key={index} className="break-words">
              <a
                href={document.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="text-primary underline"
              >
                {document.name ||
                  t('crm.documents.unnamed', locale) + ' ' + numbers.number(index + 1)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
