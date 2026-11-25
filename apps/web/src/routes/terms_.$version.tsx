import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';

const Page = lazyRouteComponent(() => import('../pages/TermsPage.js'), 'TermsPage');

function TermsVersionRoute() {
  const { version } = Route.useParams();
  const { lang } = Route.useSearch();
  if (!/^[a-z0-9_-]{1,128}$/i.test(version)) throw notFound();
  return <Page locale={lang} version={version} />;
}

export const Route = createFileRoute('/terms_/$version')({
  validateSearch: (raw: Record<string, unknown>) => ({
    lang: raw.lang === 'en' ? ('en' as const) : ('fa' as const),
  }),
  component: TermsVersionRoute,
});
