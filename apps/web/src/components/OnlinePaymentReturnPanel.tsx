import { useRef, useState } from 'react';
import type { Locale } from '@barghsa/i18n/app';
import { tWalletPaymentReturn as t } from '@barghsa/i18n/wallet-payment-return';
import { withCsrf } from '../lib/csrf.js';

export interface WalletPaymentReturn {
  orderId: string;
  authority: string;
}

/** A browser return is read-only until the customer asks the server to verify payment. */
export function OnlinePaymentReturnPanel({
  payment,
  locale,
  onConfirmed,
}: {
  payment: WalletPaymentReturn;
  locale: Locale;
  onConfirmed: () => void;
}) {
  const busy = useRef(false);
  const [status, setStatus] = useState<
    'idle' | 'checking' | 'credited' | 'unpaid' | 'auth' | 'error'
  >('idle');
  async function checkPayment() {
    if (busy.current || status === 'credited') return;
    busy.current = true;
    setStatus('checking');
    try {
      const response = await fetch('/api/wallet/top-ups/return', {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payment),
      });
      if (response.status === 401 || response.status === 403) {
        setStatus('auth');
        return;
      }
      if (!response.ok) throw new Error('Payment verification unavailable');
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object') throw new Error('Invalid payment result');
      const body = result as { ok?: unknown; transactionId?: unknown; credited?: unknown };
      if (
        body.ok !== true ||
        body.transactionId !== payment.orderId ||
        typeof body.credited !== 'boolean'
      )
        throw new Error('Invalid payment result');
      setStatus(body.credited ? 'credited' : 'unpaid');
      if (body.credited) onConfirmed();
    } catch {
      setStatus('error');
    } finally {
      busy.current = false;
    }
  }
  return (
    <section
      className="space-y-3 rounded-lg bg-card text-card-foreground p-6 shadow-sm"
      aria-labelledby="payment-return-title"
      data-testid="payment-return"
    >
      <h2 id="payment-return-title" className="text-lg font-semibold text-foreground">
        {t('wallet.return.title', locale)}
      </h2>
      <p className="text-sm text-foreground">{t('wallet.return.description', locale)}</p>
      {status !== 'idle' && (
        <p
          role={status === 'error' || status === 'auth' ? 'alert' : 'status'}
          className="text-sm text-foreground"
          data-testid="payment-return-status"
        >
          {t(`wallet.return.${status}`, locale)}
        </p>
      )}
      {status === 'auth' && (
        <a
          href="/login"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-blue-800 underline"
        >
          {t('wallet.return.login', locale)}
        </a>
      )}
      {status !== 'credited' && (
        <button
          type="button"
          disabled={status === 'checking'}
          onClick={() => void checkPayment()}
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
          data-testid="payment-return-check"
        >
          {t('wallet.return.check', locale)}
        </button>
      )}
    </section>
  );
}
