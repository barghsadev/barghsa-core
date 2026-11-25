import { createFileRoute, useMatch } from '@tanstack/react-router';
import { SolarRequestDetailPage } from '../../pages/SolarRequestDetailPage.js';
import { relatedDocumentEntry } from '../../lib/related-document-route.js';

export const Route = createFileRoute('/_app/solar/requests/$requestId_/documents')({
  component: SolarDocumentsRoute,
});

function SolarDocumentsRoute() {
  const { requestId } = Route.useParams();
  const match = useMatch({
    from: '/_app/solar/requests/$requestId_/documents/$documentId/{-$operation}',
    shouldThrow: false,
    select: (entry) => entry.params,
  });
  const entry = match ? relatedDocumentEntry(match.documentId, match.operation) : null;
  const review = useMatch({
    from: '/_app/solar/requests/$requestId_/documents/review',
    shouldThrow: false,
    select: () => true,
  });
  return (
    <SolarRequestDetailPage
      requestId={requestId}
      view="documents"
      documentEntry={entry}
      reviewDocuments={review === true}
    />
  );
}
