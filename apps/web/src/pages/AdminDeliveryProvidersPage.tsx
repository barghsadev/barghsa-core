import { lazy, Suspense } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@barghsa/ui';
import { providerText, smsProviderText } from '@barghsa/i18n/providers';
import { useLocale } from '../hooks/useLocale.js';
import { RouteSkeleton } from '../components/RouteSkeleton.js';

const Email = lazy(() => import('./AdminEmailProvidersPage.js'));
const Sms = lazy(() => import('./AdminSmsProvidersPage.js'));

export default function AdminDeliveryProvidersPage() {
  const locale = useLocale();
  return (
    <Tabs defaultValue="email" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <a
        href={`https://github.com/barghsadev/barghsa-core/blob/main/kanban/runbooks/provider-delivery${locale === 'fa' ? '.fa' : ''}.md`}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-4 inline-block text-sm text-primary underline underline-offset-2"
      >
        {providerText('admin.providers.runbook', locale)}
      </a>
      <TabsList aria-label={smsProviderText('tabs', locale)}>
        <TabsTrigger value="email">{smsProviderText('email', locale)}</TabsTrigger>
        <TabsTrigger value="sms">{smsProviderText('sms', locale)}</TabsTrigger>
      </TabsList>
      <TabsContent value="email">
        <Suspense fallback={<RouteSkeleton layout="admin" />}>
          <Email />
        </Suspense>
      </TabsContent>
      <TabsContent value="sms">
        <Suspense fallback={<RouteSkeleton layout="admin" />}>
          <Sms />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
