import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-crm';
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

type LegalDocumentsProps = { profileId: string; canRead: boolean };
export function CrmLegalDocuments(props: LegalDocumentsProps) {
  const actor = useAccountUser();
  const contextRevision = useProfileContextRevision();
  return (
    <OwnedCrmLegalDocuments
      key={JSON.stringify([actor, contextRevision, props.profileId, props.canRead])}
      {...props}
    />
  );
}
function OwnedCrmLegalDocuments({ profileId, canRead }: LegalDocumentsProps) {
  const client = useQueryClient();
  const reader = useId();
  const actor = useAccountUser();
  const contextRevision = useProfileContextRevision();
  const sequence = useRef(0);
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
    let cancel: (() => void) | undefined;
    try {
      const key = queryKeys.profiles.detail(
        { context: 'staff', ownerId: profileId, accountId: actor, revision: contextRevision },
        JSON.stringify([reader, 'crm-legal-documents', ++sequence.current])
      );
      cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
      abort.signal.addEventListener('abort', cancel, { once: true });
      const response = await client.fetchQuery({
        queryKey: key,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: async ({ signal }) => {
          const response = await fetch('/api/crm/profiles/' + profileId + '/documents', {
            credentials: 'include',
            cache: 'no-store',
            signal,
          });
          return {
            ok: response.ok,
            value: response.ok ? ((await response.json()) as unknown) : null,
          };
        },
      });
      if (!response.ok) throw new Error('Document request failed');
      const body: unknown = response.value;
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
      if (cancel) abort.signal.removeEventListener('abort', cancel);
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
