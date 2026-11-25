import { DocumentsWorkspace } from '../components/DocumentsWorkspace.js';
import type { RecordListQuery } from '../lib/record-list-query.js';
export default function AdminDocumentsPage({
  queries,
  recordSearch,
}: {
  queries?: RecordListQuery;
  recordSearch?: Record<string, unknown>;
} = {}) {
  return <DocumentsWorkspace staff queries={queries} recordSearch={recordSearch} />;
}
