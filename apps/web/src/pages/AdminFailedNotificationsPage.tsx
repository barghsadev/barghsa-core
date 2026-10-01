import DeadLetterPanel from '../components/DeadLetterPanel.js';
import { useLocale } from '../hooks/useLocale.js';
import { CustomerCorrectionsSection } from '../components/CustomerCorrectionsPanel.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
export default function AdminFailedNotificationsPage({
  queries,
}: { queries?: ListQueryBinding } = {}) {
  const locale = useLocale();
  return (
    <div className="space-y-8">
      <DeadLetterPanel uiLocale={locale} queries={queries} />
      <CustomerCorrectionsSection locale={locale} />
    </div>
  );
}
