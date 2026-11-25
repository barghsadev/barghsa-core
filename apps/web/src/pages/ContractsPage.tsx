import type { RecordListQuery } from '../lib/record-list-query.js';
import type { CustomerContractSearch } from '../lib/customer-contract-search.js';
import { ContractsWorkspace } from '../components/ContractsWorkspace.js';
import type { CustomerContractHistoryControls } from '../components/CustomerContractFilters.js';
export default function ContractsPage({
  activeOnly = false,
  history,
  selection,
  recordSearch,
}: {
  activeOnly?: boolean;
  history?: CustomerContractHistoryControls | undefined;
  selection?: Pick<RecordListQuery, 'selected' | 'select'> | undefined;
  recordSearch?: CustomerContractSearch | undefined;
}) {
  return (
    <ContractsWorkspace
      initialState={activeOnly ? 'Active' : undefined}
      customerHistory={history}
      selection={selection}
      recordSearch={recordSearch}
    />
  );
}
