import DeadLetterPanel from '../components/DeadLetterPanel.js';
import { useLocale } from '../hooks/useLocale.js';
import { CustomerCorrectionsSection } from '../components/CustomerCorrectionsPanel.js';
export default function AdminFailedNotificationsPage() {
  const locale = useLocale();
  return (
    <div className="space-y-8">
      <DeadLetterPanel uiLocale={locale} />
      <CustomerCorrectionsSection locale={locale} />
    </div>
  );
}
