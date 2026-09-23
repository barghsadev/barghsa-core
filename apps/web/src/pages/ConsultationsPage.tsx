import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@barghsa/ui';
import { tConsultation } from '@barghsa/i18n/consultation';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { consultationNextAction } from '../lib/consultation-next-action.js';
import type { SwitcherProfile } from '../components/ProfileSwitcher.js';

interface Product {
  id: string;
  systemKey: string | null;
  title: { fa: string; en: string };
  description: { fa?: string; en?: string } | null;
}
interface RequestRow {
  id: string;
  status: string;
  product_snapshot: { title: { fa: string; en: string } };
  submitted_at: string;
  staff_owner_username: string | null;
  staff_team: string | null;
  expected_next_step: string | null;
  invoice_id: string | null;
  invoice_state: string | null;
  accepted_at: string | null;
  offer_valid_until: string | null;
  refund_pending: boolean;
}

export function ConsultationsPage() {
  const navigate = useNavigate();
  const locale = useLocale();
  const copy = (key: string) => tConsultation(key, locale);
  const [profile, setProfile] = useState<SwitcherProfile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submissionKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const profileResponse = await fetch('/api/profiles', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!profileResponse.ok) throw new Error('profile');
        const data = (await profileResponse.json()) as {
          activeProfileId: string | null;
          profiles: SwitcherProfile[];
        };
        const active = data.profiles.find((item) => item.id === data.activeProfileId) ?? null;
        if (!active) return;
        const query = `profileId=${encodeURIComponent(active.id)}`;
        const [productResponse, requestResponse] = await Promise.all([
          fetch(`/api/consultations/products?${query}`, {
            credentials: 'include',
            signal: controller.signal,
          }),
          fetch(`/api/consultations/requests?${query}`, {
            credentials: 'include',
            signal: controller.signal,
          }),
        ]);
        if (!productResponse.ok || !requestResponse.ok) throw new Error('consultations');
        const productData = (await productResponse.json()) as { products: Product[] };
        const requestData = (await requestResponse.json()) as { requests: RequestRow[] };
        if (controller.signal.aborted) return;
        setProfile(active);
        setProducts(productData.products);
        setRequests(requestData.requests);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !selectedProductId || !confirmed || submitting) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const response = await fetch('/api/consultations/requests', {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          profileId: profile.id,
          productId: selectedProductId,
          submissionKey: (submissionKey.current ??= crypto.randomUUID()),
        }),
      });
      if (!response.ok) throw new Error('submit');
      const result = (await response.json()) as { requestId: string };
      void navigate({
        to: '/consultations/$requestId',
        params: { requestId: result.requestId },
      });
    } catch {
      setSubmitError(true);
      setSubmitting(false);
    }
  }

  const profileName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.title || profile.id
    : '';

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{copy('title')}</h1>
        <p className="max-w-2xl text-muted-foreground">{copy('intro')}</p>
      </header>
      {loading && <p role="status">{copy('loading')}</p>}
      {loadError && <p role="alert">{copy('loadError')}</p>}
      {!loading && !loadError && !profile && <p role="alert">{copy('profileRequired')}</p>}
      {!loading && !loadError && profile && (
        <>
          <form onSubmit={submit} className="space-y-5">
            <div className="rounded-xl border bg-card p-4">
              <span className="text-sm text-muted-foreground">{copy('profile')}</span>
              <p className="font-medium" dir="auto">
                {profileName}
              </p>
            </div>
            <fieldset className="space-y-3">
              <legend className="text-xl font-semibold">{copy('available')}</legend>
              {!products.length && <p className="text-muted-foreground">{copy('emptyProducts')}</p>}
              {products.map((product) => (
                <label
                  key={product.id}
                  className={`flex cursor-pointer gap-3 rounded-xl border bg-card p-5 transition-colors hover:border-primary ${selectedProductId === product.id ? 'border-primary ring-1 ring-primary' : ''}`}
                >
                  <input
                    type="radio"
                    name="consultationProduct"
                    value={product.id}
                    checked={selectedProductId === product.id}
                    onChange={() => {
                      setSelectedProductId(product.id);
                      submissionKey.current = null;
                      setSubmitError(false);
                    }}
                    className="mt-1"
                  />
                  <span className="space-y-1">
                    <span className="block font-semibold" dir="auto">
                      {product.title[locale]}
                    </span>
                    {product.description?.[locale] && (
                      <span className="block text-sm text-muted-foreground" dir="auto">
                        {product.description[locale]}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
            {products.length > 0 && (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className="mt-1"
                  />
                  <span>{copy('confirm')}</span>
                </label>
                {submitError && (
                  <p role="alert" className="text-destructive">
                    {copy('submitError')}
                  </p>
                )}
                <Button type="submit" disabled={!selectedProductId || !confirmed || submitting}>
                  {copy(submitting ? 'submitting' : 'request')}
                </Button>
              </>
            )}
          </form>
          <section className="space-y-3" aria-labelledby="consultation-requests-title">
            <h2 id="consultation-requests-title" className="text-xl font-semibold">
              {copy('myRequests')}
            </h2>
            {!requests.length && <p className="text-muted-foreground">{copy('emptyRequests')}</p>}
            <ul className="space-y-3">
              {requests.map((request) => {
                const action = consultationNextAction(request, request.refund_pending, locale);
                return (
                  <li key={request.id}>
                    <Link
                      to="/consultations/$requestId"
                      params={{ requestId: request.id }}
                      className="block rounded-xl border bg-card p-4 hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="block font-semibold" dir="auto">
                        {request.product_snapshot.title[locale]}
                      </span>
                      <span className="mt-2 block text-sm">
                        {copy('status')}: {copy(`status_${request.status}`)}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {copy('nextStep')}: {action.text}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {copy('owner')}:{' '}
                        <span dir="auto">{request.staff_owner_username ?? copy('unassigned')}</span>
                      </span>
                      {request.staff_team && (
                        <span className="block text-sm text-muted-foreground">
                          {copy('team')}: <span dir="auto">{request.staff_team}</span>
                        </span>
                      )}
                      <time
                        className="mt-2 block text-xs text-muted-foreground"
                        dateTime={request.submitted_at}
                      >
                        {new Intl.DateTimeFormat(locale).format(new Date(request.submitted_at))}
                      </time>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
