import { lazy, Suspense } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@barghsa/ui';
import { smsProviderText } from '@barghsa/i18n/providers';
import { useLocale } from '../hooks/useLocale.js';
import { RouteSkeleton } from '../components/RouteSkeleton.js';

const Email = lazy(() => import('./AdminEmailProvidersPage.js'));
const Sms = lazy(() => import('./AdminSmsProvidersPage.js'));

export default function AdminDeliveryProvidersPage() {
  const locale = useLocale();
  return (
    <Tabs defaultValue="email" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
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
