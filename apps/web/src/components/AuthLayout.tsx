import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/auth';
import { publicShellText } from '@barghsa/i18n/public-shell';
import { brandName, useBrandConfig } from '../providers/BrandThemeProvider.js';
import { BrandMark } from './BrandMark.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';
import './auth-layout.css';

export interface AuthLayoutProps {
  locale?: Locale;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Public auth frame. No account data or application navigation is loaded here. */
export function AuthLayout({ locale = 'fa', children, footer }: AuthLayoutProps) {
  const { brandConfig } = useBrandConfig();
  return (
    <div className="auth-layout grid min-h-dvh bg-card" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <div className="flex min-w-0 flex-col">
        <header
          className="flex items-center justify-between gap-3 px-5 py-4 sm:px-9 lg:px-10 lg:py-6"
          data-toast-anchor
        >
          <Link
            to="/"
            className="inline-flex min-h-11 min-w-0 items-center rounded-md"
            aria-label={brandName(brandConfig, locale)}
          >
            <BrandMark />
          </Link>
          <LanguageSwitcher />
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="flex flex-1 justify-center px-5 pt-8 pb-10 sm:px-10 lg:items-center lg:py-12"
        >
          <div className="auth-form w-full max-w-(--auth-panel-max-width)">
            {children}
            <div className="mt-7 flex flex-col gap-2 border-t pt-4">
              {footer}
              <Link
                to="/support"
                className="touch-action justify-center text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                {t('auth.forgotPassword.helpLink', locale)}
              </Link>
            </div>
          </div>
        </main>
        <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t px-5 py-4 text-xs text-muted-foreground lg:border-t-0">
          <p className="min-w-0 wrap-anywhere">
            &copy; {new Date().getFullYear()} {brandName(brandConfig, locale)}
          </p>
          <p>
            {publicShellText('appVersion', locale)}{' '}
            <bdi dir="ltr" data-app-version>
              v{__BARGHSA_VERSION__}
            </bdi>
          </p>
        </footer>
      </div>
      <aside className="auth-brand-panel hidden overflow-hidden rounded-2xl bg-brand-panel text-brand-panel-foreground">
        <div className="auth-brand-image" aria-hidden="true" />
        <div className="auth-brand-caption">
          <div aria-hidden="true" className="mb-5 h-1 w-11 rounded-full bg-energy" />
          <p className="auth-brand-title font-bold text-balance">
            {publicShellText('authTitle', locale)}
          </p>
          <p className="mt-4 max-w-sm text-base leading-relaxed text-brand-panel-muted">
            {brandConfig.slogan || publicShellText('authServiceSummary', locale)}
          </p>
        </div>
      </aside>
    </div>
  );
}
