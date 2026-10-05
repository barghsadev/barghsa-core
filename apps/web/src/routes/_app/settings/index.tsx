import { createFileRoute } from '@tanstack/react-router';
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
  ShieldAlertIcon,
  UserIcon,
  MapPinIcon,
  MegaphoneIcon,
} from 'lucide-react';
import { Button, Card, CardContent } from '@barghsa/ui';
import { Form } from '@barghsa/ui/form';
import { useAccountTime } from '../../../hooks/useAccountTime.js';
import { useLocale } from '../../../hooks/useLocale.js';
import {
  usePreferenceSettingsOwner,
  usePreferenceSettingsForm,
} from '../../../hooks/usePreferenceSettingsForm.js';
import { PreferenceSettingsStatus } from '../../../components/PreferenceSettingsStatus.js';
import { PreferenceSwitch } from '../../../components/PreferenceSwitch.js';
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
  const channelToggles = [
    {
      key: 'SMS' as const,
      icon: <SmartphoneIcon className="h-5 w-5" aria-hidden="true" />,
      description: locale === 'fa' ? 'دریافت پیامک' : 'Receive SMS',
    },
    {
      key: 'EMAIL' as const,
      icon: <MailIcon className="h-5 w-5" aria-hidden="true" />,
      description: locale === 'fa' ? 'دریافت ایمیل' : 'Receive email',
    },
    {
      key: 'IN_APP' as const,
      icon: <BellRingIcon className="h-5 w-5" aria-hidden="true" />,
      description: locale === 'fa' ? 'اعلان درون برنامه‌ای' : 'In-app notifications',
    },
  ];
  return (
    <div
      className="container mx-auto max-w-2xl py-8 px-4 space-y-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      onClickCapture={(event) => {
        if (scope.isLocked() && event.target instanceof Element && event.target.closest('a')) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
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
            {!isStaff && (
              <a
                href="/settings/profile"
                className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
              >
                <UserIcon className="h-4 w-4 text-muted-foreground" />
                <span>{t('settings.profile.title', locale)}</span>
              </a>
            )}
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
            {!isStaff && (
              <a
                href="/settings/addresses"
                className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
              >
                <MapPinIcon className="h-4 w-4 text-muted-foreground" />
                <span>{t('settings.addresses.title', locale)}</span>
              </a>
            )}
            <a
              href="/settings/privacy"
              className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
            >
              <ShieldAlertIcon className="h-4 w-4 text-muted-foreground" />
              <span>{t('settings.privacy.title', locale)}</span>
            </a>
          </div>
        </CardContent>
      </Card>

      {scope.denied && <p role="alert">{copy('forbidden')}</p>}
      {!scope.denied && (
        <>
          <Card>
            <CardContent className="pt-6 space-y-4">
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
                    channelToggles.map(({ key, icon, description }) => {
                      const available = notifications.source!.availableChannels.includes(key);
                      return (
                        <PreferenceSwitch
                          key={key}
                          form={notifications.form}
                          name={key}
                          id={`notification-${key}`}
                          label={t(`settings.notifications.channel.${key}`, locale)}
                          icon={icon}
                          description={
                            available ? description : preferencesText('unavailableChannel', locale)
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
            <CardContent className="pt-6">
              <AnalyticsConsentSettings coordination={analyticsCoordination} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <MegaphoneIcon className="h-5 w-5" aria-hidden="true" />
                {t('settings.marketing.title', locale)}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('settings.marketing.description', locale)}
              </p>
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
        </>
      )}
    </div>
  );
}
