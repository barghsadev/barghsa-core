import DeadLetterPanel from '../components/DeadLetterPanel.js';
import { useLocale } from '../hooks/useLocale.js';
import { CustomerCorrectionsSection } from '../components/CustomerCorrectionsPanel.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
export default function AdminFailedNotificationsPage({
  queries,
  historyQueries,
  historySearch,
  recordId,
  recordHistory,
}: {
  queries?: ListQueryBinding;
  historyQueries?: ListQueryBinding | undefined;
  historySearch?: Record<string, unknown>;
  recordId?: string;
  recordHistory?: boolean;
} = {}) {
  const locale = useLocale();
  return (
    <div className="space-y-8">
      <DeadLetterPanel
        headingLevel={1}
        uiLocale={locale}
        queries={queries}
        historyQueries={historyQueries}
        historySearch={historySearch}
        recordId={recordId}
        recordHistory={recordHistory}
      />
      {!recordId && <CustomerCorrectionsSection locale={locale} />}
    </div>
  );
}
