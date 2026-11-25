import { DocumentsWorkspace } from '../components/DocumentsWorkspace.js';
import type { RecordListQuery } from '../lib/record-list-query.js';
export default function DocumentsPage({
  queries,
  recordSearch,
}: {
  queries?: RecordListQuery;
  recordSearch?: Record<string, unknown>;
} = {}) {
  return <DocumentsWorkspace queries={queries} recordSearch={recordSearch} />;
}
