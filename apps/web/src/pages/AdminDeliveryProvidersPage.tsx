import { lazy, Suspense } from 'react';
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@barghsa/ui';
import { providerText, smsProviderText } from '@barghsa/i18n/providers';
import { useLocale } from '../hooks/useLocale.js';
import { RouteSkeleton } from '../components/RouteSkeleton.js';

const Email = lazy(() => import('./AdminEmailProvidersPage.js'));
const Sms = lazy(() => import('./AdminSmsProvidersPage.js'));

export default function AdminDeliveryProvidersPage() {
  const locale = useLocale();
  return (
    <Tabs defaultValue="email" dir={locale === 'fa' ? 'rtl' : 'ltr'} className="gap-5">
      <PageHeader
        title={providerText('admin.providers.overview', locale)}
        actions={
          <a
            href={`https://github.com/barghsadev/barghsa-core/blob/main/kanban/runbooks/provider-delivery${locale === 'fa' ? '.fa' : ''}.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="touch-action text-sm text-primary underline underline-offset-4"
          >
            {providerText('admin.providers.runbook', locale)}
          </a>
        }
      />
      <TabsList
        variant="pills"
        activateOnFocus={false}
        aria-label={smsProviderText('tabs', locale)}
        className="group-data-[orientation=horizontal]/tabs:h-11"
      >
        <TabsTrigger value="email" className="px-4">
          {smsProviderText('email', locale)}
        </TabsTrigger>
        <TabsTrigger value="sms" className="px-4">
          {smsProviderText('sms', locale)}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="email">
        <Suspense fallback={<RouteSkeleton layout="admin" />}>
          <Email embedded />
        </Suspense>
      </TabsContent>
      <TabsContent value="sms">
        <Suspense fallback={<RouteSkeleton layout="admin" />}>
          <Sms embedded />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
