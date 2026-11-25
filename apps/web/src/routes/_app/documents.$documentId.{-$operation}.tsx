import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { customerDocumentFilters } from '../../lib/record-list-query.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';

const DocumentPage = lazyRouteComponent(() => import('../../pages/DocumentRecordPage.js'));

function DocumentRoute() {
  const { documentId, operation } = Route.useParams();
  const search = Route.useSearch();
  if (documentId === 'new') {
    if (operation) throw notFound();
    return <DocumentPage entry={{ mode: 'upload' }} search={search} />;
  }
  if (operation === 'submit' || operation === 'remove') {
    return (
      <DocumentPage entry={{ mode: 'decision', documentId, decision: operation }} search={search} />
    );
  }
  if (operation && operation !== 'replace') throw notFound();
  return (
    <DocumentPage
      entry={{ mode: operation === 'replace' ? 'replace' : 'record', documentId }}
      search={search}
    />
  );
}

export const Route = createFileRoute('/_app/documents/$documentId/{-$operation}')({
  validateSearch: customerDocumentFilters,
  beforeLoad: ({ params }) => {
    if (params.documentId !== 'new' && !staffOrderId(params.documentId)) throw notFound();
  },
  component: DocumentRoute,
});
