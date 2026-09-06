import DeadLetterPanel from '../components/DeadLetterPanel.js';
import { useLocale } from '../hooks/useLocale.js';
export default function AdminFailedNotificationsPage() {
  const locale = useLocale();
  return <DeadLetterPanel uiLocale={locale} />;
}
