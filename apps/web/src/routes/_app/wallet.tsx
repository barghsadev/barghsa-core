import { createFileRoute, useSearch } from '@tanstack/react-router';
import { WalletPage } from '../../pages/WalletPage.js';
import { isInvoiceUuid } from '../../lib/due-at-override.js';

export const Route = createFileRoute('/_app/wallet')({ component: WalletRoute });

function WalletRoute() {
  // Return-query handling belongs to this route's component chunk, not the shared bootstrap.
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const returnInvoiceId =
    typeof search.returnInvoiceId === 'string' && isInvoiceUuid(search.returnInvoiceId)
      ? search.returnInvoiceId
      : undefined;
  const orderId = search.paymentOrderId;
  const authority = search.paymentAuthority;
  const paymentReturn =
    typeof orderId === 'string' &&
    orderId.length > 0 &&
    orderId.length <= 128 &&
    typeof authority === 'string' &&
    authority.length > 0 &&
    authority.length <= 512
      ? { orderId, authority }
      : undefined;
  return <WalletPage paymentReturn={paymentReturn} returnInvoiceId={returnInvoiceId} />;
}
