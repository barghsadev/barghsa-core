import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button, Card, CardContent } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { withCsrf } from '../lib/csrf.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface Product {
  id: string;
  title: { fa: string; en: string };
  status: string;
  stock_tracking?: boolean;
  available_count?: number;
}
interface Plan {
  id: string;
  hardware: Product[];
}
interface Address {
  id: string;
  fullAddress: string;
  postalCode: string;
}
interface Quote {
  reviewDigest: string;
  subtotalIrR: string;
  discountIrR: string;
  vatIrR: string;
  totalIrR: string;
}

export function SavingOrderChangePanel({
  orderId,
  profileId,
  planId,
  currentHardwareId,
  currentAddressId,
  onChanged,
}: {
  orderId: string;
  profileId: string;
  planId: string;
  currentHardwareId: string;
  currentAddressId: string;
  onChanged: () => void;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const [hardware, setHardware] = useState<Product[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [hardwareId, setHardwareId] = useState(currentHardwareId);
  const [addressId, setAddressId] = useState(currentAddressId);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changeKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch('/api/saving/plans', { credentials: 'include', signal: controller.signal }),
      fetch(`/api/profiles/${profileId}/addresses`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([plansResponse, addressResponse]) => {
        if (!plansResponse.ok || !addressResponse.ok) throw new Error('load');
        const plans = (await plansResponse.json()) as { plans: Plan[] };
        const saved = (await addressResponse.json()) as { addresses: Address[] };
        if (controller.signal.aborted) return;
        setHardware(plans.plans.find((plan) => plan.id === planId)?.hardware ?? []);
        setAddresses(saved.addresses);
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [planId, profileId]);

  const changed = hardwareId !== currentHardwareId || addressId !== currentAddressId;
  function selectHardware(value: string) {
    setHardwareId(value);
    setQuote(null);
    setError('');
    changeKey.current = null;
  }
  function selectAddress(value: string) {
    setAddressId(value);
    setQuote(null);
    setError('');
    changeKey.current = null;
  }
  async function post<T>(suffix: string, body: unknown): Promise<T> {
    const response = await fetch(`/api/saving/orders/${orderId}/${suffix}`, {
      method: 'POST',
      credentials: 'include',
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(String(response.status));
    return response.json() as Promise<T>;
  }
  async function preview() {
    setBusy(true);
    setError('');
    try {
      setQuote(
        await post<Quote>('change-quote', {
          hardwareProductId: hardwareId,
          installationAddressId: addressId,
        })
      );
    } catch {
      setQuote(null);
      setError(copy('quoteError'));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!quote) return;
    setBusy(true);
    setError('');
    changeKey.current ??= crypto.randomUUID();
    try {
      await post('change', {
        hardwareProductId: hardwareId,
        installationAddressId: addressId,
        expectedQuoteDigest: quote.reviewDigest,
        idempotencyKey: changeKey.current,
      });
      changeKey.current = null;
      setQuote(null);
      onChanged();
    } catch {
      setError(copy('changeError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{copy('changeOrder')}</h2>
          <p className="text-sm text-muted-foreground">{copy('changeOrderHelp')}</p>
        </div>
        {status === 'loading' && <p role="status">{copy('loading')}</p>}
        {status === 'error' && <p role="alert">{copy('changeUnavailable')}</p>}
        {status === 'ready' && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="saving-change-hardware">
                {copy('stepHardware')}
              </label>
              <select
                id="saving-change-hardware"
                className="w-full rounded-md border bg-background px-3 py-2"
                value={hardwareId}
                onChange={(event) => selectHardware(event.target.value)}
              >
                {hardware.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={
                      item.id !== currentHardwareId &&
                      (item.status !== 'active' ||
                        (!!item.stock_tracking && (item.available_count ?? 0) <= 0))
                    }
                  >
                    {item.title[locale]}
                    {item.status !== 'active'
                      ? ` · ${copy('unavailable')}`
                      : item.stock_tracking && (item.available_count ?? 0) <= 0
                        ? ` · ${copy('outOfStock')}`
                        : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="saving-change-address">
                {copy('stepAddress')}
              </label>
              <select
                id="saving-change-address"
                className="w-full rounded-md border bg-background px-3 py-2"
                value={addressId}
                onChange={(event) => selectAddress(event.target.value)}
              >
                {addresses.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullAddress} · {item.postalCode}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {status === 'ready' && (
          <Link
            to="/settings/addresses"
            className="inline-block text-sm text-primary hover:underline"
          >
            {copy('manageAddresses')}
          </Link>
        )}
        {status === 'ready' && changed && !quote && (
          <Button variant="outline" disabled={busy} onClick={() => void preview()}>
            {copy('previewChange')}
          </Button>
        )}
        {quote && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-4 text-sm" aria-live="polite">
            <p>
              {copy('subtotal')}: <bdi>{numbers.money(quote.subtotalIrR)}</bdi>
            </p>
            <p>
              {copy('discount')}: <bdi>{numbers.money(quote.discountIrR)}</bdi>
            </p>
            {quote.discountIrR !== '0' && (
              <p className="text-muted-foreground">{copy('retainedDiscount')}</p>
            )}
            <p>
              {copy('vat')}: <bdi>{numbers.money(quote.vatIrR)}</bdi>
            </p>
            <p className="font-semibold">
              {copy('total')}: <bdi>{numbers.money(quote.totalIrR)}</bdi>
            </p>
            <Button disabled={busy} onClick={() => void confirm()}>
              {busy ? copy('changingOrder') : copy('confirmChange')}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
