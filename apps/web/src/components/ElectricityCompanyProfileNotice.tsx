import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/workspace';
import { simpleElectricityOrderText } from '@barghsa/i18n/simple-electricity-order';
import { buttonVariants } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';

export default function ElectricityCompanyProfileNotice({
  heading: Heading = 'h1',
}: {
  heading?: 'h1' | 'h2';
}) {
  const locale = useLocale();
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <Heading className="text-lg font-semibold">
        {simpleElectricityOrderText('companyProfileTitle', locale)}
      </Heading>
      <p className="text-sm text-muted-foreground">
        {simpleElectricityOrderText('companyProfileHelp', locale)}
      </p>
      <Link
        to="/settings/profile"
        className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
      >
        {t('dashboard.profile.manage', locale)}
      </Link>
    </section>
  );
}
