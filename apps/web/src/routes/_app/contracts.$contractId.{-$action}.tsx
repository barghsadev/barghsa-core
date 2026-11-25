import { createFileRoute, lazyRouteComponent, Link, notFound } from '@tanstack/react-router';
import { contractText } from '@barghsa/i18n/contracts';
import { ContractDetailLoader } from '../../components/ContractDetailLoader.js';
import { RouteErrorBoundary } from '../../components/RouteErrorBoundary.js';
import { RouteSkeleton } from '../../components/RouteSkeleton.js';
import {
  customerContractId,
  customerContractRecordSearch,
  customerContractSearch,
} from '../../lib/customer-contract-search.js';
import { useLocale } from '../../hooks/useLocale.js';

const Cancellation = lazyRouteComponent(() => import('../../pages/ContractCancellationPage.js'));

function ContractRecordRoute() {
  const { contractId, action } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const locale = useLocale();

  if (action === 'cancel')
    return <Cancellation contractId={contractId} view={{ action: 'request' }} search={search} />;
  if (action) throw notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-3" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <Link
        to="/contracts"
        search={customerContractSearch(search)}
        className="inline-flex min-h-11 items-center text-sm text-primary hover:underline"
      >
        {contractText('backToContracts', locale)}
      </Link>
      <ContractDetailLoader
        key={contractId}
        id={contractId}
        staff={false}
        recordPage
        initialVersionId={search.versionId}
        customerRecordSearch={search}
        onWithdrawal={() =>
          void navigate({ to: '/contracts', search: customerContractSearch(search), replace: true })
        }
      />
    </div>
  );
}

export const Route = createFileRoute('/_app/contracts/$contractId/{-$action}')({
  validateSearch: customerContractRecordSearch,
  beforeLoad: ({ params }) => {
    if (!customerContractId(params.contractId)) throw notFound();
  },
  component: ContractRecordRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
