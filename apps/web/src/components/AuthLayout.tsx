import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/auth';
import { publicShellText } from '@barghsa/i18n/public-shell';
import { brandName, useBrandConfig } from '../providers/BrandThemeProvider.js';
import { AuthIntro } from './AuthIntro.js';
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
  const name = brandName(brandConfig, locale);
  return (
    <div className="auth-layout min-h-dvh bg-background" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="auth-header flex items-center justify-between gap-3" data-toast-anchor>
        <Link
          to="/"
          className="inline-flex min-h-11 min-w-0 items-center rounded-md"
          aria-label={name}
        >
          <BrandMark />
        </Link>
        <LanguageSwitcher />
      </header>
      <div className="auth-content">
        <main id="main-content" tabIndex={-1} className="auth-main flex min-w-0 justify-center">
          <div className="auth-form w-full min-w-0 max-w-(--auth-panel-max-width) rounded-2xl border bg-card p-4 sm:p-6">
            {children}
            <div className="mt-4 flex flex-col items-center gap-1.5 border-t pt-3 sm:mt-5">
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
        <AuthIntro locale={locale} slogan={brandConfig.slogan} />
      </div>
      <footer className="auth-footer flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <p className="min-w-0 wrap-anywhere">
          &copy; {new Date().getFullYear()} {name}
        </p>
        <p>
          {publicShellText('appVersion', locale)}{' '}
          <bdi dir="ltr" data-app-version>
            v{__BARGHSA_VERSION__}
          </bdi>
        </p>
      </footer>
    </div>
  );
}
