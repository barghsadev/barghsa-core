import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from '@tanstack/react-router';
import { Button } from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { createBrowserAnalytics } from '../lib/analytics-client.js';

type Consent = boolean | null;
interface AnalyticsConsentContextValue {
  consent: Consent;
  status: 'loading' | 'ready' | 'error';
  saving: boolean;
  saveError: boolean;
  updateConsent(value: boolean): Promise<void>;
  reload(): void;
}
const AnalyticsConsentContext = createContext<AnalyticsConsentContextValue | null>(null);

function parseConsent(value: unknown): Consent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const consent = (value as { consent?: unknown }).consent;
  return consent === null || typeof consent === 'boolean' ? consent : undefined;
}

export function useAnalyticsConsent() {
  const value = useContext(AnalyticsConsentContext);
  if (!value) throw new Error('AnalyticsConsentProvider is required');
  return value;
}

export function AnalyticsConsentProvider({
  area,
  children,
}: {
  area: 'customer' | 'admin';
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const analytics = useMemo(createBrowserAnalytics, []);
  const [consent, setConsent] = useState<Consent>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const request = new AbortController();
    setStatus('loading');
    void (async () => {
      try {
        const response = await fetch('/api/user/analytics/consent', { signal: request.signal });
        if (!response.ok) throw new Error('Consent read failed');
        const value = parseConsent(await response.json());
        if (value === undefined) throw new Error('Invalid consent response');
        if (!request.signal.aborted) {
          setConsent(value);
          setStatus('ready');
        }
      } catch {
        if (!request.signal.aborted) setStatus('error');
      }
    })();
    return () => request.abort();
  }, [revision]);

  useEffect(() => {
    analytics.setConsent(status === 'ready' && consent === true);
    return () => analytics.setConsent(false);
  }, [analytics, consent, status]);

  useEffect(() => {
    if (status === 'ready' && consent === true) void analytics.track({ name: 'page_view', area });
  }, [analytics, area, consent, pathname, status]);

  const updateConsent = useCallback(
    async (value: boolean) => {
      if (saving) return;
      setSaving(true);
      setSaveError(false);
      try {
        const response = await fetch('/api/user/analytics/consent', {
          method: 'PUT',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ consent: value }),
        });
        if (!response.ok || parseConsent(await response.json()) !== value)
          throw new Error('Consent save failed');
        setConsent(value);
        setStatus('ready');
      } catch {
        setSaveError(true);
      } finally {
        setSaving(false);
      }
    },
    [saving]
  );

  const context = useMemo(
    () => ({ consent, status, saving, saveError, updateConsent, reload }),
    [consent, status, saving, saveError, updateConsent, reload]
  );
  return (
    <AnalyticsConsentContext.Provider value={context}>{children}</AnalyticsConsentContext.Provider>
  );
}

/** Shown once per account until the user makes an explicit choice. */
export function AnalyticsConsentBanner() {
  const locale = useLocale();
  const { consent, status, saving, saveError, updateConsent } = useAnalyticsConsent();
  if (status !== 'ready' || consent !== null) return null;
  return (
    <section
      aria-label={shellText('analyticsTitle', locale)}
      className="border-b border-border bg-muted px-4 py-3 text-sm text-foreground"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <p className="min-w-56 flex-1">{shellText('analyticsPrompt', locale)}</p>
        <Button size="sm" disabled={saving} onClick={() => void updateConsent(true)}>
          {shellText('analyticsAllow', locale)}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => void updateConsent(false)}
        >
          {shellText('analyticsDecline', locale)}
        </Button>
        {saveError && (
          <p role="alert" className="text-destructive">
            {shellText('analyticsError', locale)}
          </p>
        )}
      </div>
    </section>
  );
}

export function AnalyticsConsentSettings() {
  const locale = useLocale();
  const { consent, status, saving, saveError, updateConsent, reload } = useAnalyticsConsent();
  return (
    <section className="space-y-3" aria-label={shellText('analyticsTitle', locale)}>
      <h2 className="text-lg font-semibold">{shellText('analyticsTitle', locale)}</h2>
      <p className="text-sm text-muted-foreground">{shellText('analyticsDescription', locale)}</p>
      {status === 'loading' && <p role="status">{shellText('analyticsLoading', locale)}</p>}
      {status === 'error' && (
        <Button size="sm" variant="outline" onClick={reload}>
          {shellText('analyticsRetry', locale)}
        </Button>
      )}
      {status === 'ready' && (
        <>
          <p className="text-sm">
            {shellText(
              consent === true
                ? 'analyticsAllowed'
                : consent === false
                  ? 'analyticsDeclined'
                  : 'analyticsUndecided',
              locale
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={saving || consent === true}
              onClick={() => void updateConsent(true)}
            >
              {shellText('analyticsAllow', locale)}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving || consent === false}
              onClick={() => void updateConsent(false)}
            >
              {shellText('analyticsDecline', locale)}
            </Button>
          </div>
        </>
      )}
      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          {shellText('analyticsError', locale)}
        </p>
      )}
    </section>
  );
}
