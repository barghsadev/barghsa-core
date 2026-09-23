import { ContractsWorkspace } from '../components/ContractsWorkspace.js';
export default function ContractsPage({ activeOnly = false }: { activeOnly?: boolean }) {
  return <ContractsWorkspace initialState={activeOnly ? 'Active' : undefined} />;
}
