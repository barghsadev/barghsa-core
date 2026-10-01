import { DocumentsWorkspace } from '../components/DocumentsWorkspace.js';
import type { RecordListQuery } from '../lib/record-list-query.js';
export default function AdminDocumentsPage({ queries }: { queries?: RecordListQuery } = {}) {
  return <DocumentsWorkspace staff {...(queries ? { queries } : {})} />;
}
