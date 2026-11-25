import { createFileRoute, lazyRouteComponent, notFound, redirect } from '@tanstack/react-router';
import { StaffRecordLoading } from '../../components/RouteSkeleton.js';
import { pendingReceiptSearch } from '../../lib/finance-list-query.js';
import { isInvoiceUuid } from '../../lib/invoice-uuid.js';
import { walletReceiptAction } from '../../lib/wallet-receipt-action.js';

const Page = lazyRouteComponent(() => import('../../pages/AdminWalletReceiptsPage.js'));

function WalletReceiptRoute() {
  const { receiptId, action } = Route.useParams();
  return (
    <Page
      key={receiptId}
      recordId={receiptId}
      recordAction={walletReceiptAction(action)}
      recordSearch={Route.useSearch()}
    />
  );
}

export const Route = createFileRoute('/admin/wallet-receipts/$receiptId/{-$action}')({
  validateSearch: pendingReceiptSearch,
  beforeLoad: ({ params, search }) => {
    const receiptId = params.receiptId.trim().toLowerCase();
    const action = walletReceiptAction(params.action);
    if (!isInvoiceUuid(receiptId) || (params.action && !action)) throw notFound();
    if (receiptId !== params.receiptId) {
      throw redirect({
        to: '/admin/wallet-receipts/$receiptId/{-$action}',
        params: { receiptId, action },
        search,
        replace: true,
      });
    }
  },
  component: WalletReceiptRoute,
  pendingComponent: StaffRecordLoading,
});
