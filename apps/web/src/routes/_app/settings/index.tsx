import { useAccountTime } from '../../../hooks/useAccountTime.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { preferencesText } from '@barghsa/i18n/preferences';
import { t } from '@barghsa/i18n';
import {
  BellIcon,
  SmartphoneIcon,
  MailIcon,
  BellRingIcon,
  Loader2Icon,
  SaveIcon,
  GlobeIcon,
  ShieldAlertIcon,
  UserIcon,
  MapPinIcon,
  MegaphoneIcon,
} from 'lucide-react';
import { Button, Card, CardContent } from '@barghsa/ui';
import { withCsrf } from '../../../lib/csrf.js';
import { useLocale } from '../../../hooks/useLocale.js';

export const Route = createFileRoute('/_app/settings/')({
  component: SettingsIndexPage,
});

// ─── Types ────────────────────────────────────────────────────────────

type NotificationChannel = 'SMS' | 'EMAIL' | 'IN_APP';

interface ChannelToggle {
  key: NotificationChannel;
  icon: React.ReactNode;
  label: string;
  description: string;
}

interface ConsentChannelState {
  optedIn: boolean;
  lastChangedAt: string | null;
}

type MarketingChannels = 'email' | 'sms';

function readChannels(body: unknown): NotificationChannel[] {
  const channels = (body as { channels?: unknown } | null)?.channels;
  if (
    !Array.isArray(channels) ||
    !channels.includes('IN_APP') ||
    channels.some((value) => !['SMS', 'EMAIL', 'IN_APP'].includes(value)) ||
    new Set(channels).size !== channels.length
  )
    throw new Error('Invalid preferences');
  return channels as NotificationChannel[];
}

function readConsent(body: unknown): Record<MarketingChannels, ConsentChannelState> {
  const channels = (body as { channels?: Record<string, unknown> } | null)?.channels;
  for (const key of ['email', 'sms']) {
    const value = channels?.[key] as Partial<ConsentChannelState> | undefined;
    if (
      !value ||
      typeof value.optedIn !== 'boolean' ||
      !(
        value.lastChangedAt === null ||
        (typeof value.lastChangedAt === 'string' &&
          Number.isFinite(Date.parse(value.lastChangedAt)))
      )
    )
      throw new Error('Invalid consent');
  }
  return channels as Record<MarketingChannels, ConsentChannelState>;
}

// ─── Page Component ────────────────────────────────────────────────────

function SettingsIndexPage() {
  const time = useAccountTime();
  const locale = useLocale();

  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);

  // Marketing consent state (T-05.05.03)
  const [marketing, setMarketing] = useState<Record<MarketingChannels, ConsentChannelState>>({
    email: { optedIn: false, lastChangedAt: null },
    sms: { optedIn: false, lastChangedAt: null },
  });
  const [marketingLoading, setMarketingLoading] = useState(true);
  const [marketingSaving, setMarketingSaving] = useState(false);
  const [marketingLoadFailed, setMarketingLoadFailed] = useState(false);
  const [marketingSaveFailed, setMarketingSaveFailed] = useState(false);
  const [marketingSaved, setMarketingSaved] = useState(false);
  const marketingSavingRef = useRef(false);

  // ── Fetch current preferences ──────────────────────────────────────

  const fetchPreferences = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/user/settings/notifications');
      if (!response.ok) throw new Error('Read failed');
      setChannels(readChannels(await response.json()));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  // ── Toggle handler ─────────────────────────────────────────────────

  const handleToggle = (channel: NotificationChannel) => {
    if (channel === 'IN_APP' || loading || loadFailed || savingRef.current) return; // In-app is always enabled
    setSaved(false);
    setSaveFailed(false);
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    );
  };

  // ── Save handler ───────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (loading || loadFailed || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveFailed(false);
    setSaved(false);
    try {
      const response = await fetch('/api/user/settings/notifications', {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ channels }),
      });
      if (!response.ok) throw new Error('Save failed');
      const confirmed = readChannels(await response.json());
      if (
        confirmed.length !== channels.length ||
        channels.some((value) => !confirmed.includes(value))
      )
        throw new Error('Mismatched preferences');
      setChannels(confirmed);
      setSaved(true);
    } catch {
      setSaveFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [channels, loading, loadFailed]);

  // ── Marketing consent (T-05.05.03) ───────────────────────────────

  const fetchMarketingConsent = useCallback(async () => {
    setMarketingLoading(true);
    setMarketingLoadFailed(false);
    try {
      const response = await fetch('/api/user/settings/marketing-consent');
      if (!response.ok) throw new Error('Read failed');
      setMarketing(readConsent(await response.json()));
    } catch {
      setMarketingLoadFailed(true);
    } finally {
      setMarketingLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMarketingConsent();
  }, [fetchMarketingConsent]);

  const handleMarketingToggle = (channel: MarketingChannels) => {
    if (marketingLoading || marketingLoadFailed || marketingSavingRef.current) return;
    setMarketingSaved(false);
    setMarketingSaveFailed(false);
    setMarketing((prev) => ({
      ...prev,
      [channel]: { ...prev[channel], optedIn: !prev[channel].optedIn },
    }));
  };

  const handleMarketingSave = useCallback(async () => {
    if (marketingLoading || marketingLoadFailed || marketingSavingRef.current) return;
    marketingSavingRef.current = true;
    setMarketingSaving(true);
    setMarketingSaveFailed(false);
    setMarketingSaved(false);
    try {
      const response = await fetch('/api/user/settings/marketing-consent', {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email: marketing.email.optedIn, sms: marketing.sms.optedIn }),
      });
      if (!response.ok) throw new Error('Save failed');
      const confirmed = readConsent(await response.json());
      if (
        confirmed.email.optedIn !== marketing.email.optedIn ||
        confirmed.sms.optedIn !== marketing.sms.optedIn
      )
        throw new Error('Mismatched consent');
      setMarketing(confirmed);
      setMarketingSaved(true);
    } catch {
      setMarketingSaveFailed(true);
    } finally {
      marketingSavingRef.current = false;
      setMarketingSaving(false);
    }
  }, [marketing, marketingLoading, marketingLoadFailed]);

  const formatConsentDate = (iso: string | null): string | null => {
    if (!iso) return null;
    return time.format(iso);
  };

  const renderMarketingToggle = (
    channel: MarketingChannels,
    icon: React.ReactNode,
    label: string
  ) => {
    const state = marketing[channel];
    return (
      <div
        className={`flex items-center justify-between rounded-lg border p-3 ${
          state.optedIn ? 'bg-muted/50' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          <span className={state.optedIn ? 'text-primary' : 'text-muted-foreground'}>{icon}</span>
          <div>
            <p className="text-sm font-medium">{label}</p>
            {state.lastChangedAt ? (
              <p className="text-xs text-muted-foreground">
                {t('settings.marketing.lastChangedAt', locale).replace(
                  '{date}',
                  formatConsentDate(state.lastChangedAt) ?? ''
                )}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('settings.marketing.neverChanged', locale)}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.optedIn}
          aria-label={label}
          disabled={marketingSaving || marketingLoading || marketingLoadFailed}
          onClick={() => handleMarketingToggle(channel)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 ${
            state.optedIn ? 'bg-primary' : 'bg-input'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
              state.optedIn ? 'translate-x-6' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    );
  };

  // ── Channel definitions ────────────────────────────────────────────

  const channelToggles: ChannelToggle[] = [
    {
      key: 'SMS',
      icon: <SmartphoneIcon className="h-5 w-5" />,
      label: t('settings.notifications.channel.SMS', locale),
      description: locale === 'fa' ? 'دریافت پیامک' : 'Receive SMS',
    },
    {
      key: 'EMAIL',
      icon: <MailIcon className="h-5 w-5" />,
      label: t('settings.notifications.channel.EMAIL', locale),
      description: locale === 'fa' ? 'دریافت ایمیل' : 'Receive email',
    },
    {
      key: 'IN_APP',
      icon: <BellRingIcon className="h-5 w-5" />,
      label: t('settings.notifications.channel.IN_APP', locale),
      description: locale === 'fa' ? 'اعلان درون برنامه‌ای' : 'In-app notifications',
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <h1 className="text-2xl font-bold mb-6">{t('dashboard.nav.settings', locale)}</h1>

      {/* Settings navigation links */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <GlobeIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {locale === 'fa' ? 'تنظیمات دیگر' : 'Other Settings'}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <a
              href="/settings/profile"
              className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
            >
              <UserIcon className="h-4 w-4 text-muted-foreground" />
              <span>{t('settings.profile.title', locale)}</span>
            </a>
            <a
              href="/settings/username"
              className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
            >
              <UserIcon className="h-4 w-4 text-muted-foreground" />
              <span>{t('settings.username.title', locale)}</span>
            </a>
            <a
              href="/settings/security"
              className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
            >
              <ShieldAlertIcon className="h-4 w-4 text-muted-foreground" />
              <span>{t('settings.security.title', locale)}</span>
            </a>
            <a
              href="/settings/timezone"
              className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
            >
              <GlobeIcon className="h-4 w-4 text-muted-foreground" />
              <span>{t('settings.timezone.title', locale)}</span>
            </a>
            <a
              href="/settings/addresses"
              className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
            >
              <MapPinIcon className="h-4 w-4 text-muted-foreground" />
              <span>{t('settings.addresses.title', locale)}</span>
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <BellIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t('settings.notifications.title', locale)}</h2>
          </div>

          <p className="text-sm text-muted-foreground">
            {t('settings.notifications.description', locale)}
          </p>

          {/* Loading */}
          {loading && (
            <div className="text-center py-4 text-muted-foreground">
              <Loader2Icon className="mx-auto h-5 w-5 animate-spin mb-2" />
              <p className="text-sm">{t('settings.security.loading', locale)}</p>
            </div>
          )}

          {loadFailed && (
            <div role="alert">
              <p>{preferencesText('loadFailed', locale)}</p>
              <Button onClick={fetchPreferences} disabled={loading}>
                {preferencesText('retry', locale)}
              </Button>
            </div>
          )}
          {saveFailed && <p role="alert">{t('settings.notifications.error.save', locale)}</p>}
          {saved && <p role="status">{t('settings.notifications.success', locale)}</p>}

          {/* Toggle switches */}
          {!loading && !loadFailed && (
            <div className="space-y-3">
              {channelToggles.map((channel) => {
                const isEnabled = channels.includes(channel.key);
                const isAlwaysOn = channel.key === 'IN_APP';

                return (
                  <div
                    key={channel.key}
                    className={`flex items-center justify-between rounded-lg border p-3 ${
                      isEnabled ? 'bg-muted/50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={isEnabled ? 'text-primary' : 'text-muted-foreground'}>
                        {channel.icon}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{channel.label}</p>
                        <p className="text-xs text-muted-foreground">{channel.description}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isEnabled}
                      aria-label={channel.label}
                      disabled={isAlwaysOn || saving}
                      onClick={() => handleToggle(channel.key)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 ${
                        isEnabled ? 'bg-primary' : 'bg-input'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                          isEnabled ? 'translate-x-6' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Hint text */}
          <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            {t('settings.notifications.hint', locale)}
          </p>

          {/* Save button */}
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving || loading || loadFailed}
              className="gap-2"
            >
              {saving ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <SaveIcon className="h-4 w-4" />
              )}
              {saving
                ? t('settings.notifications.saving', locale)
                : t('settings.profile.save', locale)}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Marketing Consent (T-05.05.03) */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <MegaphoneIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t('settings.marketing.title', locale)}</h2>
          </div>

          <p className="text-sm text-muted-foreground">
            {t('settings.marketing.description', locale)}
          </p>

          {marketingLoading && (
            <div className="text-center py-4 text-muted-foreground">
              <Loader2Icon className="mx-auto h-5 w-5 animate-spin mb-2" />
              <p className="text-sm">{t('settings.marketing.loading', locale)}</p>
            </div>
          )}

          {marketingLoadFailed && (
            <div role="alert">
              <p>{preferencesText('loadFailed', locale)}</p>
              <Button onClick={fetchMarketingConsent} disabled={marketingLoading}>
                {preferencesText('retry', locale)}
              </Button>
            </div>
          )}
          {marketingSaveFailed && <p role="alert">{t('settings.marketing.error.save', locale)}</p>}
          {marketingSaved && <p role="status">{t('settings.marketing.success', locale)}</p>}

          {!marketingLoading && !marketingLoadFailed && (
            <div className="space-y-3">
              {renderMarketingToggle(
                'email',
                <MailIcon className="h-5 w-5" />,
                t('settings.marketing.optInEmailLabel', locale)
              )}
              {renderMarketingToggle(
                'sms',
                <SmartphoneIcon className="h-5 w-5" />,
                t('settings.marketing.optInSmsLabel', locale)
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleMarketingSave}
              disabled={marketingSaving || marketingLoading || marketingLoadFailed}
              className="gap-2"
            >
              {marketingSaving ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <SaveIcon className="h-4 w-4" />
              )}
              {marketingSaving
                ? t('settings.marketing.saving', locale)
                : t('settings.profile.save', locale)}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
