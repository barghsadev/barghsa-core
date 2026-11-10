import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { Alert } from '@barghsa/ui';
import { AuditLogViewer } from '../components/AuditLogViewer.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNavigation } from '../hooks/useNavigation.js';
import { useProfileContextRevision } from '../lib/profile-context.js';

const auditLabels = {
  fa: {
    title: 'رد دسترسی‌های اخیر',
    description: 'رد دسترسی به منابع و عملیات را بررسی کنید.',
    show: 'نمایش سوابق',
    hide: 'پنهان کردن سوابق',
    loading: 'در حال بارگیری سوابق رد دسترسی',
    empty: 'رد دسترسی ثبت نشده است.',
    denied: 'دسترسی به سوابق رد دسترسی مجاز نیست.',
    error: 'بارگیری سوابق رد دسترسی ممکن نشد.',
    retry: 'تلاش دوباره برای بارگیری سوابق',
    refresh: 'تازه‌سازی سوابق',
    more: 'سوابق قدیمی‌تر',
    authorization_denied: 'دسترسی رد شد',
    'field.resource': 'منبع',
    'field.action': 'عملیات',
    'field.reason': 'دلیل',
    'field.correlationId': 'شناسه پیگیری',
  },
  en: {
    title: 'Recent denials',
    description: 'Review denied access to resources and actions.',
    show: 'View denials',
    hide: 'Hide denials',
    loading: 'Loading authorization denials',
    empty: 'No authorization denials recorded.',
    denied: 'You do not have access to authorization denials.',
    error: 'Could not load authorization denials.',
    retry: 'Try loading denials again',
    refresh: 'Refresh denials',
    more: 'Older denials',
    authorization_denied: 'Access denied',
    'field.resource': 'Resource',
    'field.action': 'Action',
    'field.reason': 'Reason',
    'field.correlationId': 'Correlation ID',
  },
} as const;

export default function AdminAuthorizationAudit() {
  const locale = useLocale();
  const account = useAccountUser();
  const revision = useProfileContextRevision();
  const allowed = useNavigation()?.paths.includes('/admin/authorization-audit');
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t('admin.audit.authorization.title', locale)}</h1>
      {account && allowed ? (
        <AuditLogViewer
          key={JSON.stringify([account, revision])}
          scope="authorization"
          labels={auditLabels[locale]}
        />
      ) : (
        <Alert variant="destructive">{auditLabels[locale].denied}</Alert>
      )}
    </div>
  );
}
