import { createFileRoute, notFound } from '@tanstack/react-router';
import type { CustomerCorrectionSearch } from '../../lib/customer-corrections.js';
import { staffOrderId } from '../../lib/staff-order-list-query.js';
import Page from '../../pages/CustomerCorrectionsPage.js';

export const Route = createFileRoute(
  '/admin/failed-notifications_/corrections/{-$correctionId}/{-$action}'
)({
  validateSearch: (search): CustomerCorrectionSearch => ({
    ...(search.completed === true ? { completed: true } : {}),
    ...(typeof search.offset === 'number' &&
    Number.isInteger(search.offset) &&
    search.offset > 0 &&
    search.offset <= 1000000
      ? { offset: search.offset }
      : {}),
  }),
  beforeLoad: ({ params: { correctionId, action } }) => {
    if (
      (correctionId !== undefined && !staffOrderId(correctionId)) ||
      (action !== undefined && (action !== 'resolve' || !correctionId))
    )
      throw notFound();
  },
  component: CorrectionRoute,
});

function CorrectionRoute() {
  const { correctionId, action } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const id = correctionId?.toLowerCase();
  return (
    <Page
      {...(id ? { correctionId: id } : {})}
      editing={action === 'resolve'}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, resetScroll: false })}
    />
  );
}
