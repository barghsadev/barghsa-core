import { ContractsWorkspace } from '../components/ContractsWorkspace.js';
import type { RecordListQuery } from '../lib/record-list-query.js';
export default function AdminContractsPage({ queries }: { queries?: RecordListQuery } = {}) {
  return <ContractsWorkspace staff {...(queries ? { queries } : {})} />;
}
