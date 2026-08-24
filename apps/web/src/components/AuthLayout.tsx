import { Link } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import { Card, CardContent } from '@barghsa/ui'

export interface AuthLayoutProps {
  /** The locale for i18n text (fa or en) */
  locale?: Locale
  /** Form content rendered in the right column */
  children: React.ReactNode
  /** Optional bottom-of-form footer links (e.g. login link) */
  footer?: React.ReactNode
}

/**
 * Shared two-column auth layout used by all auth pages (register, login, forgot-password).
 *
 * Left column: brand details (logo, title, slogan, value propositions).
 * Right column: form content passed as children.
 *
 * Responsive: stacks vertically on mobile (single column).
 * Full RTL/LTR support through dir attribute and logical CSS properties.
 * Does NOT render the default app sidebar or navbar.
 */
export function AuthLayout({ locale = 'fa', children, footer }: AuthLayoutProps) {
  return (
    <div
      className="flex min-h-dvh flex-col md:flex-row"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {/* Left: Brand column — hidden on mobile, shown as sidebar on md+ */}
      <aside className="hidden md:flex md:w-1/2 lg:w-3/5 xl:w-1/2 flex-col justify-between bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 p-8 lg:p-12 xl:p-16">
        <div>
          {/* Logo placeholder */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-2xl font-bold text-primary no-underline hover:opacity-80 transition-opacity"
            aria-label={t('auth.brand.logo.alt', locale)}
          >
            {/* Simple SVG logo mark — Barghsa bolt icon */}
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              className="shrink-0"
            >
              <rect width="32" height="32" rx="8" fill="currentColor" />
              <path
                d="M18 6L9 18h5l-1 8 9-12h-5l1-8z"
                fill="var(--primary-foreground)"
              />
            </svg>
            <span>{t('auth.brand.title', locale)}</span>
          </Link>

          {/* Slogan */}
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-md">
            {t('auth.brand.slogan', locale)}
          </p>

          {/* Value propositions */}
          <ul className="mt-8 space-y-4">
            {(['value1', 'value2', 'value3'] as const).map((key) => (
              <li key={key} className="flex items-start gap-3 text-sm text-muted-foreground">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 shrink-0 text-primary"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{t(`auth.brand.${key}`, locale)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom brand area */}
        <div className="text-xs text-muted-foreground/60">
          &copy; {new Date().getFullYear()} {t('auth.brand.title', locale)}
        </div>
      </aside>

      {/* Mobile brand header — shown only on small screens */}
      <div className="flex md:hidden flex-col items-center py-8 px-4 border-b border-border bg-gradient-to-b from-primary/5 to-background">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xl font-bold text-primary no-underline"
          aria-label={t('auth.brand.logo.alt', locale)}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect width="32" height="32" rx="8" fill="currentColor" />
            <path
              d="M18 6L9 18h5l-1 8 9-12h-5l1-8z"
              fill="var(--primary-foreground)"
            />
          </svg>
          <span>{t('auth.brand.title', locale)}</span>
        </Link>
        <p className="mt-2 text-sm text-muted-foreground text-center max-w-xs">
          {t('auth.brand.slogan', locale)}
        </p>
      </div>

      {/* Right: Form column */}
      <main className="flex flex-1 items-center justify-center p-4 md:p-8 lg:p-12">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            {children}
          </CardContent>
          {footer && (
            <div className="px-(--card-spacing) pb-(--card-spacing)">
              {footer}
            </div>
          )}
        </Card>
      </main>
    </div>
  )
}