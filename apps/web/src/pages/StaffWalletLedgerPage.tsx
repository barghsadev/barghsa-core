import { PageHeader } from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/admin-ui';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useLocale } from '../hooks/useLocale.js';
import { WalletTransactionList } from '../components/WalletTransactionList.js';

export default function StaffWalletLedgerPage({
  profileId,
  queries,
}: {
  profileId: string;
  queries: ListQueryBinding;
}) {
  const locale = useLocale();
  return (
    <div
      className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <Link
        to="/admin/reconciliation"
        search={{}}
        className="self-start text-sm text-primary underline underline-offset-4"
      >
        {t('admin.walletLedger.back', locale)}
      </Link>
      <PageHeader title={t('admin.walletLedger.title', locale)} />
      <bdi dir="ltr" className="break-all text-sm text-muted-foreground">
        {profileId}
      </bdi>
      <WalletTransactionList profileId={profileId} locale={locale} binding={queries} staff />
    </div>
  );
}
