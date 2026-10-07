import { PageHeader } from '@barghsa/ui';
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
    <div className="flex flex-col gap-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <PageHeader
        title={t('admin.walletLedger.title', locale)}
        description={t('admin.walletLedger.description', locale)}
      />
      <bdi dir="ltr" className="break-all text-sm text-muted-foreground">
        {profileId}
      </bdi>
      <WalletTransactionList profileId={profileId} locale={locale} binding={queries} staff />
    </div>
  );
}
