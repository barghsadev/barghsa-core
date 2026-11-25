import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Alert } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import ContractLimitsRecovery from '../components/ContractLimitsRecovery.js';
import { useLocale } from '../hooks/useLocale.js';

const ignore = () => {};

export default function ContractLimitsHistoryPage() {
  const locale = useLocale();
  const label = (key: string) => t(`admin.contractLimits.${key}`, locale);
  const [denied, setDenied] = useState(false);
  return (
    <section className="max-w-4xl space-y-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <Link
        to="/admin/contract-limits"
        className="touch-action text-sm text-primary underline underline-offset-4"
      >
        {label('title')}
      </Link>
      <h1 className="text-2xl font-semibold">{label('recoveryTitle')}</h1>
      {denied ? (
        <Alert variant="destructive">{label('forbidden')}</Alert>
      ) : (
        <ContractLimitsRecovery
          path="/api/admin/config/contract-electricity-limits"
          label={label}
          disabled={false}
          showRevisions
          onBusyChange={ignore}
          onDenied={() => setDenied(true)}
          onActivated={ignore}
        />
      )}
    </section>
  );
}
