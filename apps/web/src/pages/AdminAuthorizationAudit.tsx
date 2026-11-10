import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { Alert } from '@barghsa/ui';
import { AuditLogViewer } from '../components/AuditLogViewer.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNavigation } from '../hooks/useNavigation.js';
import { useProfileContextRevision } from '../lib/profile-context.js';

export default function AdminAuthorizationAudit() {
  const locale = useLocale();
  const account = useAccountUser();
  const revision = useProfileContextRevision();
  const allowed = useNavigation()?.paths.includes('/admin/authorization-audit');
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t('admin.audit.authorization.title', locale)}</h1>
      {account && allowed ? (
        <AuditLogViewer key={JSON.stringify([account, revision])} scope="authorization" />
      ) : (
        <Alert variant="destructive">{t('admin.audit.authorization.denied', locale)}</Alert>
      )}
    </div>
  );
}
