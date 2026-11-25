import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAccountUser } from './useAccountUser.js';
import { useManualServerRead } from './useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';

export interface WalletBalance {
  balance: string;
  postedBalance?: string;
  reservedBalance?: string;
  currency: string;
  onlineTopUpLimit?: number;
  configVersion?: number;
}

export async function walletReadPacket(path: string, signal: AbortSignal) {
  const response = await fetch(path, { credentials: 'include', signal });
  return {
    ok: response.ok,
    status: response.status,
    data: response.ok ? ((await response.json()) as unknown) : null,
  };
}

export function walletBalance(data: unknown): WalletBalance | null {
  const balance = data as WalletBalance | null;
  return balance &&
    typeof balance.balance === 'string' &&
    /^[0-9]+$/.test(balance.balance) &&
    typeof balance.currency === 'string' &&
    balance.currency.trim()
    ? balance
    : null;
}

export function useWalletBalance<OperationError extends string = never>(onWithdraw?: () => void) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const reader = useId();
  const readWallet = useManualServerRead();
  const loadRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const withdrawReview = useRef(onWithdraw);
  withdrawReview.current = onWithdraw;
  const [profileId, setProfileId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'load' | 'no-profile' | OperationError | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadRequest.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    const current = () =>
      mounted.current && loadRequest.current === controller && !controller.signal.aborted;
    const read = (key: ServerQueryKey, path: string) => {
      if (!current()) throw new Error('Abandoned wallet read');
      return readWallet(key, controller.signal, (signal) => walletReadPacket(path, signal));
    };
    const withdraw = () => {
      setWallet(null);
      setProfileId(null);
      withdrawReview.current?.();
    };
    setLoading(true);
    setError(null);
    try {
      const profileRes = await read(
        queryKeys.profiles.authority(
          {
            context: 'account',
            ownerId: actor?.trim() ? actor : reader,
            accountId: actor,
            revision: profileRevision,
          },
          '/api/profiles'
        ),
        '/api/profiles'
      );
      if (!current()) return;
      if (!profileRes.ok) {
        if ([401, 403, 404].includes(profileRes.status)) withdraw();
        setError('load');
        return;
      }
      const profileData = profileRes.data as { activeProfileId: string | null } | null;
      if (
        !profileData ||
        (profileData.activeProfileId !== null &&
          (typeof profileData.activeProfileId !== 'string' || !profileData.activeProfileId.trim()))
      ) {
        withdraw();
        setError('load');
        return;
      }
      if (!profileData.activeProfileId) {
        setError('no-profile');
        setProfileId(null);
        setWallet(null);
        return;
      }
      setProfileId(profileData.activeProfileId);
      const walletRes = await read(
        queryKeys.wallet.balance({
          context: 'customer',
          ownerId: profileData.activeProfileId,
          accountId: actor,
          revision: profileRevision,
        }),
        `/api/wallet/${profileData.activeProfileId}`
      );
      if (!current()) return;
      if (!walletRes.ok) {
        if ([401, 403, 404].includes(walletRes.status)) withdraw();
        setError('load');
        return;
      }
      const walletData = walletBalance(walletRes.data);
      if (!walletData) {
        withdraw();
        setError('load');
        return;
      }
      setWallet(walletData);
    } catch {
      if (current()) setError('load');
    } finally {
      if (current()) {
        setLoading(false);
        loadRequest.current = null;
      }
    }
  }, [actor, profileRevision, reader, readWallet]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    profileId,
    setProfileId,
    wallet,
    setWallet,
    loading,
    setLoading,
    error,
    setError,
    load,
    mounted,
    readWallet,
    loadRequest,
  };
}
