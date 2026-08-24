import { createFileRoute, Link } from '@tanstack/react-router'
import { t } from '@barghsa/i18n'
import { Button, Input, Label } from '@barghsa/ui'
import { AuthLayout } from '../components/AuthLayout.js'

export const Route = createFileRoute('/register')({
  component: RegisterPage,
})

function RegisterPage() {
  const locale = 'fa' // TODO: read from user preference / locale context

  return (
    <AuthLayout
      locale={locale}
      footer={
        <p className="text-center text-sm text-muted-foreground">
          {t('auth.register.loginLink', locale)}{' '}
          <Link
            to="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
            aria-label={t('auth.register.loginLinkLabel', locale)}
          >
            {t('auth.register.loginLinkLabel', locale)}
          </Link>
        </p>
      }
    >
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            {t('auth.register.title', locale)}
          </h1>
        </div>

        {/* Registration form shell — fields will be added in T-01.01.02+ */}
        <form
          onSubmit={(e) => e.preventDefault()}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="username">
              {t('auth.register.emailLabel', locale)}
            </Label>
            <Input
              id="username"
              type="text"
              placeholder={t('auth.register.emailPlaceholder', locale)}
              autoComplete="username"
              disabled
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">
              {t('auth.register.passwordLabel', locale)}
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              disabled
            />
          </div>

          <Button type="submit" className="w-full" disabled>
            {t('auth.register.submit', locale)}
          </Button>
        </form>

        {/* Placeholder for TOS checkbox (T-01.01.04) */}
        {/* Placeholder for OTP step (T-01.02.02) */}
      </div>
    </AuthLayout>
  )
}