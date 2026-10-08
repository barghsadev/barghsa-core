import { useId, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { WalletFundingPrompt } from './WalletFundingPrompt.js';
import { Button } from '@barghsa/ui';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { queryKeys } from '../lib/query-keys.js';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';

export function OrderWalletBalance({
  profileId,
  total,
  paid = '0',
  invoiceId,
  scopeKey = '',
  staff = false,
}: {
  profileId: string;
  total?: string;
  paid?: string;
  invoiceId?: string | null;
  scopeKey?: string;
  staff?: boolean;
}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const actor = useAccountUser(),
    profileRevision = useProfileContextRevision();
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([actor, profileRevision, profileId, scopeKey, staff, revision]);
  const reader = useId();
  const readOwner = useRef({ key, revision: 0 });
  if (readOwner.current.key !== key)
    readOwner.current = { key, revision: readOwner.current.revision + 1 };
  const query = useServerDetailQuery<{ balance: string | null; denied: boolean }>({
    queryKey:
      typeof profileId === 'string' && profileId.trim()
        ? queryKeys.wallet.balance(
            {
              context: staff ? 'staff' : 'customer',
              ownerId: profileId,
              accountId: actor,
              revision: profileRevision,
            },
            JSON.stringify([reader, scopeKey, readOwner.current.revision])
          )
        : null,
    read: async (signal) => {
      const response = await fetch(
        staff
          ? `/api/staff/profiles/${encodeURIComponent(profileId)}/wallet-balance`
          : `/api/wallet/${encodeURIComponent(profileId)}`,
        { credentials: 'include', signal, cache: 'no-store' }
      );
      if (response.status === 403 || response.status === 404)
        return { balance: null, denied: true };
      if (!response.ok) throw new Error('Wallet unavailable');
      const value = (await response.json()) as {
        balance?: unknown;
        profileId?: unknown;
        currency?: unknown;
      };
      if (
        value.currency !== 'IRR' ||
        typeof value.balance !== 'string' ||
        !/^-?\d{1,20}$/.test(value.balance) ||
        (staff && value.profileId !== profileId)
      )
        throw new Error('Invalid wallet balance');
      return { balance: value.balance, denied: false };
    },
  });
  const current =
    query.isPending || query.isFetching
      ? null
      : query.isSuccess
        ? query.data
        : { balance: null, denied: false };
  let remaining = '0';
  try {
    const amount =
      /^(0|[1-9]\d*)$/.test(total ?? '0') && /^(0|[1-9]\d*)$/.test(paid)
        ? BigInt(total ?? '0') - BigInt(paid)
        : 0n;
    if (amount > 0n) remaining = amount.toString();
  } catch {
    /* Invalid monetary facts never create a funding amount. */
  }
  return (
    <div data-testid="order-wallet-balance" className="flex flex-col gap-2 text-sm">
      <p role="status">
        {t('wallet.funding.balance', locale)}:{' '}
        {current?.balance === null || !current ? '—' : numbers.money(current.balance)}
      </p>
      {!current ? (
        <p>{t('wallet.funding.loading', locale)}</p>
      ) : current.balance === null && (current.denied || remaining === '0') ? (
        <p>{t(current.denied ? 'wallet.funding.denied' : 'wallet.funding.unknown', locale)}</p>
      ) : null}
      {remaining !== '0' && current && !current.denied ? (
        <WalletFundingPrompt
          balance={current.balance}
          total={remaining}
          {...(invoiceId ? { returnInvoiceId: invoiceId } : {})}
          staff={staff}
        />
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!current}
        onClick={() => setRevision((value) => value + 1)}
      >
        {t('wallet.funding.refresh', locale)}
      </Button>
    </div>
  );
}
