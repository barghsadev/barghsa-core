import { createFileRoute } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import { Card, CardContent } from '@barghsa/ui'

export const Route = createFileRoute('/_app/settings/')({
  component: SettingsIndexPage,
})

function SettingsIndexPage() {
  const locale: Locale = 'fa' // TODO: read from locale context

  return (
    <div dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold mb-4">{t('dashboard.nav.settings', locale)}</h1>
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">
            {locale === 'fa' ? 'تنظیمات حساب شما' : 'Your account settings'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}