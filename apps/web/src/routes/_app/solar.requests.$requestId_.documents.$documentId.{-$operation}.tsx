import { createFileRoute, notFound } from '@tanstack/react-router';
import { relatedDocumentEntry } from '../../lib/related-document-route.js';

export const Route = createFileRoute(
  '/_app/solar/requests/$requestId_/documents/$documentId/{-$operation}'
)({
  beforeLoad: ({ params }) => {
    if (!relatedDocumentEntry(params.documentId, params.operation)) throw notFound();
  },
});
