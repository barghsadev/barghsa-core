import type { RecordListQuery } from '../lib/record-list-query.js';
import { ContractsWorkspace } from '../components/ContractsWorkspace.js';
import type { CustomerContractHistoryControls } from '../components/CustomerContractFilters.js';
export default function ContractsPage({
  activeOnly = false,
  history,
  selection,
}: {
  activeOnly?: boolean;
  history?: CustomerContractHistoryControls | undefined;
  selection?: Pick<RecordListQuery, 'selected' | 'select'> | undefined;
}) {
  return (
    <ContractsWorkspace
      initialState={activeOnly ? 'Active' : undefined}
      customerHistory={history}
      selection={selection}
    />
  );
}
