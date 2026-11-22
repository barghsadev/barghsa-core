import { createFileRoute, Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { preferencesText } from '@barghsa/i18n/preferences';
import { tPreferenceSettingsForms } from '@barghsa/i18n/preference-settings-forms';
import {
  BellIcon,
  SmartphoneIcon,
  MailIcon,
  BellRingIcon,
  SaveIcon,
  GlobeIcon,
  ShieldCheckIcon,
  UserIcon,
  MapPinIcon,
  MegaphoneIcon,
  ChevronRightIcon,
  FingerprintIcon,
  ShieldAlertIcon,
} from 'lucide-react';
import { Button, Card, CardContent, CardHeader, PageHeader } from '@barghsa/ui';
import { Form } from '@barghsa/ui/form';
import { useAccountTime } from '../../../hooks/useAccountTime.js';
import { useLocale } from '../../../hooks/useLocale.js';
import {
  usePreferenceSettingsOwner,
  usePreferenceSettingsForm,
} from '../../../hooks/usePreferenceSettingsForm.js';
import { PreferenceSettingsStatus } from '../../../components/PreferenceSettingsStatus.js';
import { PreferenceSwitch } from '../../../components/PreferenceSwitch.js';
import { HighContrastPreference } from '../../../components/HighContrastPreference.js';
import { AnalyticsConsentSettings } from '../../../providers/AnalyticsConsentProvider.js';
import {
  notificationSettings,
  notificationValues,
  notificationBody,
  notificationConfirmed,
  marketingSettings,
  marketingValues,
  marketingConfirmed,
  type NotificationValues,
  type NotificationSettings,
  type MarketingValues,
  type MarketingSettings,
} from '../../../lib/preference-settings-form.js';
export const Route = createFileRoute('/_app/settings/')({ component: SettingsIndexPage });

const accountSections = [
  { to: '/settings/profile', label: 'settings.profile.title', icon: UserIcon, customerOnly: true },
  { to: '/settings/username', label: 'settings.username.title', icon: FingerprintIcon },
  { to: '/settings/security', label: 'settings.security.title', icon: ShieldCheckIcon },
  { to: '/settings/timezone', label: 'settings.timezone.title', icon: GlobeIcon },
  {
    to: '/settings/addresses',
    label: 'settings.addresses.title',
    icon: MapPinIcon,
    customerOnly: true,
  },
  { to: '/settings/privacy', label: 'settings.privacy.title', icon: ShieldAlertIcon },
] as const;

function SettingsIndexPage() {
  const { isStaff } = Route.useRouteContext();
  const time = useAccountTime(),
    locale = useLocale(),
    scope = usePreferenceSettingsOwner();
  const copy = (key: string) => tPreferenceSettingsForms(key, locale);
  const notifications = usePreferenceSettingsForm<NotificationValues, NotificationSettings>(
    scope,
    locale,
    {
      family: 'notifications',
      successMessage: copy('savedToast'),
      path: '/api/user/settings/notifications',
      initial: { IN_APP: true, EMAIL: false, SMS: false },
      parse: notificationSettings,
      values: notificationValues,
      body: notificationBody,
      confirmed: notificationConfirmed,
      schema: (module, source) =>
        module.notificationSettingsSchema(copy, source?.availableChannels ?? ['IN_APP']),
    }
  );
  const marketing = usePreferenceSettingsForm<MarketingValues, MarketingSettings>(scope, locale, {
    family: 'marketing',
    successMessage: copy('savedToast'),
    path: '/api/user/settings/marketing-consent',
    initial: { email: false, sms: false },
    parse: marketingSettings,
    values: marketingValues,
    body: (values) => ({ ...values }),
    confirmed: marketingConfirmed,
    schema: (module) => module.marketingSettingsSchema(copy),
  });
  const analyticsCoordination = {
    locked: scope.locked || !scope.isCurrent(),
    isLocked: () => scope.isLocked() || !scope.isCurrent(),
    claim: () => scope.claim('analytics'),
    release: () => scope.release('analytics'),
  };
  const channels = notifications.form.watch();
  const showMarketingDates =
    marketing.source &&
    (marketing.source.channels.email.lastChangedAt || marketing.source.channels.sms.lastChangedAt);
  const channelToggles = [
    { key: 'SMS', icon: SmartphoneIcon },
    { key: 'EMAIL', icon: MailIcon },
    { key: 'IN_APP', icon: BellRingIcon },
  ] as const;
  return (
    <div
      className="mx-auto flex max-w-5xl flex-col gap-6"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      onClickCapture={(event) => {
        if (scope.isLocked() && event.target instanceof Element && event.target.closest('a')) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <PageHeader
        title={t('dashboard.nav.settings', locale)}
        description={preferencesText('overview', locale)}
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <h2 id="account-settings-links" className="text-lg font-semibold">
                {preferencesText('account', locale)}
              </h2>
            </CardHeader>
            <CardContent>
              <nav aria-labelledby="account-settings-links">
                <ul className="divide-y">
                  {accountSections.map((section) => {
                    if (isStaff && 'customerOnly' in section) return null;
                    const Icon = section.icon;
                    return (
                      <li key={section.to}>
                        <Link
                          to={section.to}
                          className="flex min-h-12 items-center gap-3 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted"
                        >
                          <Icon
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">{t(section.label, locale)}</span>
                          <ChevronRightIcon
                            className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">{preferencesText('display', locale)}</h2>
            </CardHeader>
            <CardContent>
              <HighContrastPreference />
            </CardContent>
          </Card>
        </div>
        <div className="min-w-0 space-y-5">
          {scope.denied ? (
            <p role="alert">{copy('forbidden')}</p>
          ) : (
            <>
              <Card>
                <CardContent className="space-y-4">
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <BellIcon className="h-5 w-5" aria-hidden="true" />
                    {t('settings.notifications.title', locale)}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.notifications.description', locale)}
                  </p>
                  <Form {...notifications.form}>
                    <form
                      noValidate
                      ref={notifications.feedback.element}
                      onSubmit={notifications.submit}
                      aria-label={t('settings.notifications.title', locale)}
                      className="space-y-3"
                    >
                      {notifications.source &&
                        channelToggles.map(({ key, icon: Icon }) => {
                          const available = notifications.source!.availableChannels.includes(key);
                          return (
                            <PreferenceSwitch
                              key={key}
                              form={notifications.form}
                              name={key}
                              id={`notification-${key}`}
                              label={t(`settings.notifications.channel.${key}`, locale)}
                              icon={<Icon className="size-5 shrink-0" aria-hidden="true" />}
                              description={
                                available
                                  ? undefined
                                  : preferencesText('unavailableChannel', locale)
                              }
                              disabled={
                                notifications.locked ||
                                key === 'IN_APP' ||
                                (!available && !channels[key])
                              }
                              guarded={() => scope.isLocked() || !notifications.ready}
                            />
                          );
                        })}
                      <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                        {t('settings.notifications.hint', locale)}
                      </p>
                      <div className="flex justify-end">
                        <Button type="submit" disabled={notifications.locked} className="gap-2">
                          <SaveIcon className="h-4 w-4" aria-hidden="true" />
                          {t(
                            notifications.busy
                              ? 'settings.notifications.saving'
                              : 'settings.profile.save',
                            locale
                          )}
                        </Button>
                      </div>
                    </form>
                  </Form>
                  <PreferenceSettingsStatus
                    editor={notifications}
                    locale={locale}
                    locked={scope.locked}
                    enabled={scope.isCurrent()}
                    loadError={preferencesText('loadFailed', locale)}
                    retry={preferencesText('retry', locale)}
                    success={t('settings.notifications.success', locale)}
                    saveError={t('settings.notifications.error.save', locale)}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-4">
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <MegaphoneIcon className="h-5 w-5" aria-hidden="true" />
                    {t('settings.marketing.title', locale)}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.marketing.description', locale)}
                  </p>
                  {showMarketingDates && time.notice && (
                    <fieldset
                      disabled={scope.locked}
                      onClickCapture={(event) => {
                        if (scope.isLocked()) {
                          event.preventDefault();
                          event.stopPropagation();
                        }
                      }}
                    >
                      {time.notice}
                    </fieldset>
                  )}
                  <Form {...marketing.form}>
                    <form
                      noValidate
                      ref={marketing.feedback.element}
                      onSubmit={marketing.submit}
                      aria-label={t('settings.marketing.title', locale)}
                      className="space-y-3"
                    >
                      {marketing.source &&
                        (['email', 'sms'] as const).map((key) => (
                          <PreferenceSwitch
                            key={key}
                            form={marketing.form}
                            name={key}
                            id={`marketing-${key}`}
                            label={t(
                              key === 'email'
                                ? 'settings.marketing.optInEmailLabel'
                                : 'settings.marketing.optInSmsLabel',
                              locale
                            )}
                            description={
                              marketing.source?.channels[key].lastChangedAt
                                ? t('settings.marketing.lastChangedAt', locale).replace(
                                    '{date}',
                                    time.format(marketing.source.channels[key].lastChangedAt!)
                                  )
                                : t('settings.marketing.neverChanged', locale)
                            }
                            disabled={marketing.locked}
                            guarded={() => scope.isLocked() || !marketing.ready}
                          />
                        ))}
                      <div className="flex justify-end">
                        <Button type="submit" disabled={marketing.locked} className="gap-2">
                          <SaveIcon className="h-4 w-4" aria-hidden="true" />
                          {t(
                            marketing.busy ? 'settings.marketing.saving' : 'settings.profile.save',
                            locale
                          )}
                        </Button>
                      </div>
                    </form>
                  </Form>
                  <PreferenceSettingsStatus
                    editor={marketing}
                    locale={locale}
                    locked={scope.locked}
                    enabled={scope.isCurrent()}
                    loadError={preferencesText('loadFailed', locale)}
                    retry={preferencesText('retry', locale)}
                    success={t('settings.marketing.success', locale)}
                    saveError={t('settings.marketing.error.save', locale)}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <AnalyticsConsentSettings coordination={analyticsCoordination} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
