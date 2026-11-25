import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ConversationIdentityDialog } from '../../../components/ConversationIdentityDialog.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';
import { useLocale } from '../../../hooks/useLocale.js';

export const Route = createFileRoute('/_app/settings/conversation-identity')({
  component: ConversationIdentitySettings,
  errorComponent: RouteErrorBoundary,
});

function ConversationIdentitySettings() {
  const locale = useLocale();
  const navigate = useNavigate();
  return (
    <ConversationIdentityDialog
      locale={locale}
      presentation="page"
      onClose={() => void navigate({ to: '/settings', replace: true })}
    />
  );
}
