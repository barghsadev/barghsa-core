import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Alert, AlertDescription } from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { tSaving } from '@barghsa/i18n/saving';
import { useLocale } from '../hooks/useLocale.js';
import {
  relatedDocumentListLocation,
  relatedDocumentLocation,
  savingDocumentsEditable,
  type RelatedDocumentContext,
  type RelatedDocumentEntry,
} from '../lib/related-document-route.js';
import { DocumentDetail } from './DocumentDetail.js';
import { RelatedDocumentEditor } from './RelatedDocumentEditor.js';

export default function SavingOrderDocumentScreen({
  context,
  entry,
  order,
  feedback,
}: {
  context: Extract<RelatedDocumentContext, { kind: 'order' }>;
  entry: RelatedDocumentEntry;
  order: {
    profileId: string;
    status: string;
    address?: string | undefined;
    billIdentifier?: string | undefined;
  } | null;
  feedback: ReactNode;
}) {
  const locale = useLocale();
  const copy = (key: string) => tSaving(key, locale);
  const title =
    entry.mode === 'detail' || entry.mode === 'decision'
      ? documentText(entry.mode === 'decision' ? entry.decision : 'details', locale)
      : copy(entry.mode === 'upload' ? 'documentUpload' : 'documentReplace');
  const writable = !!order && savingDocumentsEditable(order.status);
  const backToFile = (entry.mode === 'replace' || entry.mode === 'decision') && !!order;
  const back = backToFile
    ? relatedDocumentLocation(context, entry.documentId)
    : relatedDocumentListLocation(context);
  return (
    <div
      className="mx-auto w-full max-w-3xl min-w-0 space-y-3 px-4 pb-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      data-slot="saving-order-document"
      data-toast-anchor
    >
      <Link
        {...back}
        className="touch-action inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {backToFile ? documentText('backToDocument', locale) : copy('backToOrderDocuments')}
      </Link>
      {!order ? (
        <>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {feedback}
        </>
      ) : entry.mode === 'detail' || entry.mode === 'decision' ? (
        <DocumentDetail
          id={entry.documentId}
          profileId={order.profileId}
          staff={context.staff}
          savingPreSubmissionOnly={!context.staff}
          allowReplacement={writable}
          related={context}
          decision={entry.mode === 'decision' ? entry.decision : undefined}
        />
      ) : writable ? (
        <RelatedDocumentEditor
          key={entry.mode === 'replace' ? entry.documentId : 'new'}
          context={context}
          profileId={order.profileId}
          replacementId={entry.mode === 'replace' ? entry.documentId : null}
          title={title}
          recordContext={
            (order.address || order.billIdentifier) && (
              <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
                {order.address && (
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{copy('stepAddress')}</dt>
                    <dd dir="auto" className="wrap-anywhere font-medium">
                      {order.address}
                    </dd>
                  </div>
                )}
                {order.billIdentifier && (
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{copy('billIdentifier')}</dt>
                    <dd className="wrap-anywhere font-medium">
                      <bdi dir="ltr">{order.billIdentifier}</bdi>
                    </dd>
                  </div>
                )}
              </dl>
            )
          }
        />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <Alert>
            <AlertDescription>{copy('orderDocumentsReadOnly')}</AlertDescription>
          </Alert>
        </>
      )}
    </div>
  );
}
