import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import type { BusinessDocument } from '../lib/documents.js';
import { RelatedDocumentEditor } from './RelatedDocumentEditor.js';

export function SolarSiteDocumentEditor({
  requestId,
  profileId,
  replacementId,
  siteAddress,
  guidance,
  requested,
  suggested,
  onUploaded,
}: {
  requestId: string;
  profileId: string;
  replacementId: string | null;
  siteAddress: string | null;
  guidance: string;
  requested: Array<{ id: string; description: string }>;
  suggested: string[];
  onUploaded: (document: BusinessDocument) => void;
}) {
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const title = copy(replacementId ? 'siteDocumentReplace' : 'siteDocumentNew');
  return (
    <div data-slot="solar-document-editor">
      <RelatedDocumentEditor
        context={{ kind: 'solar_request', id: requestId }}
        profileId={profileId}
        replacementId={replacementId}
        title={title}
        recordContext={
          <div className="mt-2 space-y-2 text-sm">
            {siteAddress && (
              <dl className="rounded-lg bg-muted/40 px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">{copy('address')}</dt>
                <dd className="wrap-anywhere font-medium" dir="auto">
                  {siteAddress}
                </dd>
              </dl>
            )}
            {guidance.trim() && (
              <p className="whitespace-pre-wrap wrap-anywhere text-muted-foreground">{guidance}</p>
            )}
            {requested.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2">
                <p className="font-medium">{copy('requestedDocuments')}</p>
                <ul className="list-disc space-y-0.5 ps-5 text-muted-foreground">
                  {requested.map((item) => (
                    <li key={item.id} className="wrap-anywhere">
                      <bdi>{item.description}</bdi>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              suggested.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium">{copy('suggestedDocuments')}</p>
                  <ul className="list-disc space-y-0.5 ps-5 text-muted-foreground">
                    {suggested.map((item, index) => (
                      <li key={index} className="wrap-anywhere">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}
          </div>
        }
        onUploaded={onUploaded}
      />
    </div>
  );
}
