import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { tWalletLimit as t } from '@barghsa/i18n/wallet-limit';
import { validateWalletTopUpLimitConfig } from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

/**
 * Admin panel for the versioned `onlineTopUpLimit` (T-04.2.02.06).
 *
 * Number input with grouped IRR formatting and a Toman preview. The
 * warning matches T-09.10.01: changing the limit affects future online
 * top-ups only. Server validation remains authoritative.
 */

interface WalletTopUpLimitDto {
  limitIrR: number;
  version: number;
}

function isConfig(value: unknown): value is WalletTopUpLimitDto {
  if (!value || typeof value !== 'object') return false;
  const data = value as WalletTopUpLimitDto;
  return (
    validateWalletTopUpLimitConfig({ limit_irr: data.limitIrR }).ok &&
    Number.isSafeInteger(data.version) &&
    data.version >= 0
  );
}

function normalizeIrrDigits(raw: string): string {
  let ascii = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x06f0 && code <= 0x06f9) {
      ascii += String(code - 0x06f0);
    } else if (code >= 0x0660 && code <= 0x0669) {
      ascii += String(code - 0x0660);
    } else {
      ascii += ch;
    }
  }
  return ascii.replace(/[^\d]/g, '');
}

export default function WalletTopUpLimitConfigPanel() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const formatGroupedIrr = (digits: string) => (digits === '' ? '' : numbers.irrDigits(digits));
  const isRtl = locale === 'fa';
  const [config, setConfig] = useState<WalletTopUpLimitDto | null>(null);
  const [limitDigits, setLimitDigits] = useState('');
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<TeamAction | null>(null);
  const generation = useRef(0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [clientIssue, setClientIssue] = useState<string | null>(null);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setConfig(null);
    setSaved(false);
    setError(null);
    setForbidden(false);
    try {
      const res = await fetch('/api/admin/config/wallet-top-up-limit', { credentials: 'include' });
      if (current !== generation.current) return;
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error('Unavailable');
      const data: unknown = await res.json();
      if (!isConfig(data)) throw new Error('Invalid configuration');
      if (current === generation.current) {
        setConfig(data);
        setLimitDigits(String(data.limitIrR));
      }
    } catch {
      if (current === generation.current) setError(t('admin.walletLimit.loadFailed', locale));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
    };
  }, [load]);

  const tomanPreview = useMemo(() => {
    if (limitDigits === '') return null;
    try {
      return BigInt(limitDigits) / 10n;
    } catch {
      return null;
    }
  }, [limitDigits]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading || !config || action) return;
    const raw = limitDigits === '' ? undefined : Number(limitDigits);
    const validation = validateWalletTopUpLimitConfig({ limit_irr: raw });
    if (!validation.ok) {
      setClientIssue(
        t('admin.walletLimit.invalid', locale).replace(
          '{max}',
          numbers.number(Number.MAX_SAFE_INTEGER)
        )
      );
      return;
    }
    setClientIssue(null);
    setSaved(false);
    setError(null);
    setAction({
      title: t('admin.walletLimit.save', locale),
      description: `${t('admin.walletLimit.label', locale)}: ${formatGroupedIrr(String(raw))}. ${t('admin.walletLimit.warning', locale)}`,
      path: '/api/admin/config/wallet-top-up-limit',
      method: 'PUT',
      body: { limit_irr: raw, expected_version: config.version },
      conflictMessage: t('admin.walletLimit.conflict', locale),
    });
  }

  if (forbidden) {
    return null;
  }

  if (loading && !config) {
    return (
      <div
        className="bg-card text-card-foreground rounded-lg border border-border p-6 text-muted-foreground"
        role="status"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {t('admin.walletLimit.loading', locale)}
      </div>
    );
  }

  const describedBy = [
    tomanPreview !== null ? 'online-top-up-limit-toman' : null,
    'online-top-up-limit-warning',
    clientIssue ? 'online-top-up-limit-error' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className="bg-card text-card-foreground rounded-lg border border-border p-6 space-y-4"
      data-testid="wallet-top-up-limit-panel"
      aria-labelledby="wallet-top-up-limit-heading"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div>
        <h2 id="wallet-top-up-limit-heading" className="text-lg font-semibold">
          {t('admin.walletLimit.title', locale)}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('admin.walletLimit.description', locale)}
        </p>
      </div>

      <p
        className="text-sm text-warning bg-warning-soft border border-warning/20 rounded px-3 py-2"
        role="note"
        id="online-top-up-limit-warning"
        data-testid="wallet-top-up-limit-warning"
      >
        {t('admin.walletLimit.warning', locale)}
      </p>

      {error && (
        <div
          className="bg-danger-soft border border-destructive/20 text-destructive px-4 py-3 rounded"
          role="alert"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label
            htmlFor="online-top-up-limit"
            className="block text-sm font-medium text-foreground mb-1"
          >
            {t('admin.walletLimit.label', locale)} <span className="text-destructive">*</span>
          </label>
          <input
            id="online-top-up-limit"
            data-testid="wallet-top-up-limit-input"
            name="limit_irr"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            disabled={loading || !config || !!action}
            value={formatGroupedIrr(limitDigits)}
            onChange={(event) => {
              setLimitDigits(normalizeIrrDigits(event.target.value));
              setSaved(false);
              setClientIssue(null);
            }}
            className="w-full border border-input rounded px-3 py-2"
            aria-invalid={clientIssue !== null}
            aria-describedby={describedBy}
          />
          {tomanPreview !== null && (
            <p
              id="online-top-up-limit-toman"
              className="mt-1 text-sm text-muted-foreground"
              data-testid="wallet-top-up-limit-toman"
            >
              {t('admin.walletLimit.toman', locale).replace(
                '{amount}',
                formatGroupedIrr(tomanPreview.toString())
              )}
            </p>
          )}
        </div>

        {clientIssue && (
          <p id="online-top-up-limit-error" className="text-sm text-destructive" role="alert">
            {clientIssue}
          </p>
        )}

        {config && (
          <p className="text-xs text-muted-foreground" data-testid="wallet-top-up-limit-current">
            {t('admin.walletLimit.current', locale)}:{' '}
            <span className="font-mono">{formatGroupedIrr(String(config.limitIrR))}</span>
            {typeof config.version === 'number' && (
              <>
                {' · '}
                {t('admin.walletLimit.version', locale).replace(
                  '{version}',
                  numbers.number(config.version)
                )}
              </>
            )}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            data-testid="wallet-top-up-limit-save"
            disabled={loading || !config || !!action}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {t('admin.walletLimit.save', locale)}
          </button>
          <button
            type="button"
            disabled={loading || !!action}
            onClick={() => void load()}
            className="px-4 py-2 border rounded"
          >
            {t('admin.walletLimit.reload', locale)}
          </button>
          {saved && (
            <span className="text-sm text-success" role="status">
              {t('admin.walletLimit.saved', locale)}
            </span>
          )}
        </div>
      </form>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (data) => {
            const submitted = action.body as { limit_irr: number; expected_version: number };
            if (
              !isConfig(data) ||
              data.limitIrR !== submitted.limit_irr ||
              data.version !== submitted.expected_version + 1
            ) {
              throw new Error('Saved configuration does not match');
            }
            setConfig(data);
            setLimitDigits(String(data.limitIrR));
            setSaved(true);
          }}
        />
      )}
    </section>
  );
}
