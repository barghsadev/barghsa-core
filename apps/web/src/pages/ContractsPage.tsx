import { ContractsWorkspace } from '../components/ContractsWorkspace.js';
import type { CustomerContractHistoryControls } from '../components/CustomerContractFilters.js';
export default function ContractsPage({
  activeOnly = false,
  history,
}: {
  activeOnly?: boolean;
  history?: CustomerContractHistoryControls | undefined;
}) {
  return (
    <ContractsWorkspace
      initialState={activeOnly ? 'Active' : undefined}
      customerHistory={history}
    />
  );
}
