import { createFileRoute, notFound } from '@tanstack/react-router';
import { isInvoiceUuid } from '../../lib/invoice-uuid.js';
import { walletTopUpSearch } from '../../lib/wallet-history-query.js';
import { WalletPage } from '../../pages/WalletPage.js';

function WalletTopUpRoute() {
  const { method } = Route.useParams();
  if (method !== 'online' && method !== 'bank-receipt') throw notFound();
  const search = Route.useSearch();
  const invoiceId = search.returnInvoiceId;
  return (
    <WalletPage
      topUpMethod={method}
      backSearch={search}
      {...(typeof invoiceId === 'string' && isInvoiceUuid(invoiceId)
        ? { returnInvoiceId: invoiceId }
        : {})}
    />
  );
}

export const Route = createFileRoute('/_app/wallet/top-up/$method')({
  validateSearch: walletTopUpSearch,
  component: WalletTopUpRoute,
});
