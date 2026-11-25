import { ContractsWorkspace } from '../components/ContractsWorkspace.js';
import type { RecordListQuery } from '../lib/record-list-query.js';

export default function AdminContractsPage({
  queries,
  recordSearch,
}: {
  queries?: RecordListQuery;
  recordSearch?: Record<string, unknown>;
} = {}) {
  return <ContractsWorkspace staff queries={queries} staffRecordSearch={recordSearch} />;
}
