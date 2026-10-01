import DeadLetterPanel from '../components/DeadLetterPanel.js';
import { useLocale } from '../hooks/useLocale.js';
import { CustomerCorrectionsSection } from '../components/CustomerCorrectionsPanel.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
export default function AdminFailedNotificationsPage({
  queries,
  historyQueries,
}: { queries?: ListQueryBinding; historyQueries?: ListQueryBinding } = {}) {
  const locale = useLocale();
  return (
    <div className="space-y-8">
      <DeadLetterPanel uiLocale={locale} queries={queries} historyQueries={historyQueries} />
      <CustomerCorrectionsSection locale={locale} />
    </div>
  );
}
