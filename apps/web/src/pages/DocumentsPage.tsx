import { DocumentsWorkspace } from '../components/DocumentsWorkspace.js';
import type { RecordListQuery } from '../lib/record-list-query.js';
export default function DocumentsPage({ queries }: { queries?: RecordListQuery } = {}) {
  return <DocumentsWorkspace {...(queries ? { queries } : {})} />;
}
