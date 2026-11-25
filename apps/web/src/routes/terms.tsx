import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';

const Page = lazyRouteComponent(() => import('../pages/TermsPage.js'), 'TermsPage');

function TermsRoute() {
  const { lang, version } = Route.useSearch();
  return <Page locale={lang} version={version} />;
}

export const Route = createFileRoute('/terms')({
  validateSearch: (raw: Record<string, unknown>) => ({
    lang: raw.lang === 'en' ? ('en' as const) : ('fa' as const),
    version:
      raw.version === undefined ? undefined : typeof raw.version === 'string' ? raw.version : '',
  }),
  beforeLoad: ({ search }) => {
    if (search.version && /^[a-z0-9_-]{1,128}$/i.test(search.version))
      throw redirect({
        to: '/terms/$version',
        params: { version: search.version },
        search: { lang: search.lang },
        replace: true,
      });
  },
  component: TermsRoute,
});
