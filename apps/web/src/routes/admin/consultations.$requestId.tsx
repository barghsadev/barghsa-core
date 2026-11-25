import {
  createFileRoute,
  lazyRouteComponent,
  notFound,
  Outlet,
  redirect,
  useRouterState,
} from '@tanstack/react-router';
import { staffOrderId } from '../../lib/staff-order-list-query.js';
import { consultationFilters } from '../../lib/support-list-query.js';
import {
  consultationDecision,
  consultationDecisionPath,
} from '../../lib/consultation-decision-route.js';

const Consultations = lazyRouteComponent(
  () => import('../../pages/AdminConsultationsPage.js'),
  'AdminConsultationsPage'
);

function ConsultationRecordRoute() {
  const { requestId } = Route.useParams();
  const editor = useRouterState({
    select: (state) => {
      const match = state.matches.at(-1);
      return match?.routeId === '/admin/consultations/$requestId/fee'
        ? 'fee'
        : consultationDecision(match?.params.decision);
    },
  });
  return (
    <>
      <Consultations
        key={requestId}
        requestId={requestId}
        recordSearch={Route.useSearch()}
        feeEditor={editor === 'fee'}
        decision={editor === 'fee' ? undefined : editor}
      />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute('/admin/consultations/$requestId')({
  validateSearch: consultationFilters,
  beforeLoad: ({ params, search, location }) => {
    const requestId = staffOrderId(params.requestId).toLowerCase();
    if (!requestId) throw notFound();
    if (params.requestId !== requestId) {
      const [, , , , section, action] = location.pathname.split('/');
      if (section === 'decisions') {
        const decision = consultationDecision(action);
        if (!decision) throw notFound();
        throw redirect({
          to: consultationDecisionPath,
          params: { requestId, decision },
          search,
          replace: true,
        });
      }
      throw redirect({
        to:
          section === 'fee'
            ? '/admin/consultations/$requestId/fee'
            : '/admin/consultations/$requestId',
        params: { requestId },
        search,
        replace: true,
      });
    }
  },
  component: ConsultationRecordRoute,
});
