import { createFileRoute } from '@tanstack/react-router';
import { ContractRefundQueue } from '../../components/ContractRefundQueue.js';
import { staffContractFilters } from '../../lib/record-list-query.js';
import { isInvoiceUuid } from '../../lib/invoice-uuid.js';

function RefundsRoute() {
  const { refund_before, ...search } = Route.useSearch();
  return <ContractRefundQueue search={search} before={refund_before ?? null} />;
}

export const Route = createFileRoute('/admin/contracts/refunds')({
  validateSearch: (search) => ({
    ...staffContractFilters(search),
    refund_before:
      typeof search.refund_before === 'string' && isInvoiceUuid(search.refund_before)
        ? search.refund_before
        : undefined,
  }),
  component: RefundsRoute,
});
