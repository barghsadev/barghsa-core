import { lazy, Suspense } from 'react';
import { Link } from '@tanstack/react-router';
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@barghsa/ui';
import { providerText, smsProviderText } from '@barghsa/i18n/providers';
import { useLocale } from '../hooks/useLocale.js';
import { RouteSkeleton } from '../components/RouteSkeleton.js';
import {
  providerDestination,
  type ProviderChannel,
  type ProviderSelection,
  type ProviderWorkspace,
} from '../lib/provider-workspace.js';

const Email = lazy(() => import('./AdminEmailProvidersPage.js'));
const Sms = lazy(() => import('./AdminSmsProvidersPage.js'));

export default function AdminDeliveryProvidersPage({
  channel,
  setChannel,
  workspace,
}: {
  channel: ProviderChannel;
  setChannel: (channel: ProviderChannel) => void;
  workspace: ProviderWorkspace;
}) {
  const locale = useLocale();
  const { selection } = workspace;
  const isTask = selection && selection.panel !== 'detail';
  const parent: ProviderSelection | undefined =
    selection && selection.panel !== 'new' && selection.panel !== 'detail'
      ? { panel: 'detail', id: selection.id }
      : undefined;
  let title = providerText('admin.providers.overview', locale);
  if (selection?.panel === 'detail') title = providerText('admin.providers.detail', locale);
  else if (selection) {
    title =
      channel === 'email'
        ? providerText(
            selection.panel === 'new'
              ? 'admin.providers.create.title'
              : 'admin.providers.update.title',
            locale
          )
        : smsProviderText(selection.panel === 'clone' ? 'clone' : selection.panel, locale);
  }
  const ProviderPage = channel === 'email' ? Email : Sms;

  return (
    <Tabs
      value={channel}
      onValueChange={(next) => {
        if (next === 'email' || next === 'sms') setChannel(next);
      }}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      className={
        isTask
          ? 'mx-auto w-full min-w-0 max-w-3xl gap-2'
          : selection
            ? 'mx-auto w-full max-w-5xl gap-5'
            : 'gap-5'
      }
    >
      {selection && (
        <Link
          {...providerDestination(channel, parent)}
          className="inline-flex min-h-11 self-start items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {providerText(
            parent ? 'admin.providers.backToDetail' : 'admin.providers.backToList',
            locale
          )}
        </Link>
      )}
      {isTask ? (
        <h1 className="mb-2 text-2xl font-semibold">{title}</h1>
      ) : (
        <PageHeader
          title={title}
          actions={
            !selection && (
              <a
                href={`https://github.com/barghsadev/barghsa-core/blob/main/kanban/runbooks/provider-delivery${locale === 'fa' ? '.fa' : ''}.md`}
                target="_blank"
                rel="noopener noreferrer"
                className="touch-action text-sm text-primary underline underline-offset-4"
              >
                {providerText('admin.providers.runbook', locale)}
              </a>
            )
          }
        />
      )}
      {!selection && (
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
      )}
      <TabsContent
        value={channel}
        role={selection ? 'region' : 'tabpanel'}
        aria-label={selection ? title : undefined}
        tabIndex={selection ? -1 : 0}
      >
        <Suspense fallback={<RouteSkeleton layout="admin" />}>
          <ProviderPage embedded workspace={workspace} />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
