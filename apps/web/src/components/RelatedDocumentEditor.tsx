import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Alert, AlertDescription, Button, LoadingStatus } from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { canReplaceDocument, validDocumentDetail } from '../lib/document-records.js';
import { isContractAttachmentRole } from '../lib/contract-attachments.js';
import { documentBase, DocumentRequestError, type BusinessDocument } from '../lib/documents.js';
import {
  relatedDocumentListLocation,
  relatedDocumentLocation,
  relatedDocumentMatches,
  type RelatedDocumentContext,
} from '../lib/related-document-route.js';
import { DocumentUpload } from './DocumentUpload.js';

export function RelatedDocumentEditor({
  context,
  profileId,
  replacementId,
  title,
  recordContext,
  onUploaded,
}: {
  context: RelatedDocumentContext;
  profileId: string;
  replacementId: string | null;
  title: string;
  recordContext?: ReactNode;
  onUploaded?: (document: BusinessDocument) => void;
}) {
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const staff = context.kind !== 'solar_request' && context.staff;
  const contractVersionId = context.kind === 'contract' ? context.versionId : undefined;
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const read = useOwnedDocumentRead(actor, revision, staff, profileId, context.id);
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const [replacement, setReplacement] = useState<BusinessDocument | null>(null);
  const [error, setError] = useState<'denied' | 'error' | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!replacementId) return;
    const controller = new AbortController();
    setError(null);
    void read<unknown>(`${documentBase(staff)}/${encodeURIComponent(replacementId)}`, {
      signal: controller.signal,
    })
      .then((document) => {
        if (controller.signal.aborted) return;
        if (
          !validDocumentDetail(document, replacementId, profileId) ||
          !relatedDocumentMatches(document, context) ||
          (context.kind === 'contract' &&
            (!isContractAttachmentRole(document.contractRole) ||
              document.permissions?.replace !== true)) ||
          !canReplaceDocument(
            document,
            staff,
            context.kind === 'solar_request',
            context.kind === 'order' && !staff
          )
        )
          setError('denied');
        else setReplacement(document);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        const denied =
          failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status);
        setError(denied ? 'denied' : 'error');
      });
    return () => controller.abort();
  }, [context.id, context.kind, contractVersionId, profileId, read, replacementId, retry, staff]);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active.contains(heading.current))
      heading.current?.focus({ preventScroll: true });
  }, [replacement]);

  const queue = relatedDocumentListLocation(context);
  if (replacementId && !replacement)
    return (
      <section className="space-y-3" data-slot="related-document-editor" aria-label={title}>
        <h1
          ref={heading}
          tabIndex={-1}
          data-slot="editor-heading"
          className="text-2xl font-semibold outline-none!"
        >
          {title}
        </h1>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{word(error)}</AlertDescription>
            {error === 'error' && (
              <Button variant="outline" onClick={() => setRetry((attempt) => attempt + 1)}>
                {word('retry')}
              </Button>
            )}
          </Alert>
        ) : (
          <LoadingStatus>{word('loading')}</LoadingStatus>
        )}
      </section>
    );
  return (
    <div data-slot="related-document-editor" data-toast-anchor>
      <DocumentUpload
        staff={staff}
        profileId={profileId}
        replacement={replacement}
        association={
          context.kind === 'contract'
            ? isContractAttachmentRole(replacement?.contractRole)
              ? {
                  businessRecordType: 'contract',
                  businessRecordId: context.id,
                  contractVersionId: context.versionId,
                  contractRole: replacement.contractRole,
                }
              : undefined
            : { businessRecordType: context.kind, businessRecordId: context.id }
        }
        recordPage
        recordTitle={title}
        recordHeadingRef={heading}
        recordContext={recordContext}
        onClose={() =>
          void navigate(replacementId ? relatedDocumentLocation(context, replacementId) : queue)
        }
        onUploaded={(document) => {
          onUploaded?.(document);
          void navigate({ ...queue, replace: true });
        }}
      />
    </div>
  );
}
