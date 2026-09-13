import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/auth';
import { shellText } from '@barghsa/i18n/shell';
import { ArrowUpRight } from 'lucide-react';
import { useBrandConfig } from '../providers/BrandThemeProvider.js';
import { BrandMark } from './BrandMark.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';

export interface AuthLayoutProps {
  locale?: Locale;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Public auth frame. No account data or application navigation is loaded here. */
export function AuthLayout({ locale = 'fa', children, footer }: AuthLayoutProps) {
  const { brandConfig } = useBrandConfig();
  return (
    <div
      className="grid min-h-dvh grid-rows-[auto_1fr] bg-card md:grid-cols-2 md:grid-rows-1"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <aside className="relative flex flex-col overflow-hidden bg-brand-panel p-5 text-brand-panel-foreground md:p-10 lg:p-14">
        <Link
          to="/"
          className="relative z-10 w-fit no-underline"
          aria-label={t('auth.brand.logo.alt', locale)}
        >
          <BrandMark inverse />
        </Link>
        <div className="relative z-10 my-auto hidden py-16 md:block">
          <p className="mb-5 text-sm font-medium text-energy">{shellText('authEyebrow', locale)}</p>
          <h2 className="max-w-lg whitespace-pre-line text-[clamp(2.5rem,4.4vw,4.5rem)] leading-[1.25] font-medium tracking-tight">
            {shellText('authTitle', locale)}
          </h2>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-brand-panel-muted">
            {brandConfig.slogan || t('auth.brand.slogan', locale)}
          </p>
          <ul className="mt-10 flex max-w-md flex-col divide-y divide-brand-panel-muted/20 border-y border-brand-panel-muted/20">
            {(['value1', 'value2', 'value3'] as const).map((key) => (
              <li key={key} className="flex items-center justify-between gap-4 py-4 text-sm">
                <span>{t(`auth.brand.${key}`, locale)}</span>
                <ArrowUpRight
                  className="size-4 shrink-0 text-energy rtl:-rotate-90"
                  aria-hidden="true"
                />
              </li>
            ))}
          </ul>
        </div>
        <svg
          className="pointer-events-none absolute -bottom-24 -end-24 hidden size-[28rem] text-brand-panel-muted/10 md:block"
          viewBox="0 0 400 400"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="200" cy="200" r="80" stroke="currentColor" />
          <circle cx="200" cy="200" r="120" stroke="currentColor" />
          <circle cx="200" cy="200" r="160" stroke="currentColor" />
          <circle cx="200" cy="200" r="199" stroke="currentColor" />
          <path d="M0 200h400M200 0v400" stroke="currentColor" />
        </svg>
        <p className="relative hidden text-xs text-brand-panel-muted md:block">
          &copy; {new Date().getFullYear()} {brandConfig.appTitle}
        </p>
      </aside>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-end px-5 py-4 md:px-10 md:py-6">
          <LanguageSwitcher />
        </div>
        <main className="flex flex-1 items-center justify-center px-6 pb-10 pt-4 sm:px-10 md:py-12">
          <div className="auth-form w-full max-w-(--auth-panel-max-width)">
            {children}
            <div className="mt-8 flex flex-col gap-5 border-t pt-6">
              {footer}
              <Link
                to="/support"
                className="text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                {t('auth.forgotPassword.helpLink', locale)}
              </Link>
            </div>
          </div>
        </main>
        <p className="px-6 pb-6 text-center text-xs text-muted-foreground">
          {shellText('authNote', locale)}
        </p>
      </div>
    </div>
  );
}
