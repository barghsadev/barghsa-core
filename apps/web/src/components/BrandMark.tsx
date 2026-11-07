import { Zap } from 'lucide-react';
import { cn } from '@barghsa/ui';
import { brandName, useBrandConfig } from '../providers/BrandThemeProvider.js';
import { useLocale } from '../hooks/useLocale.js';

/** The same mark in every shell; configured logos retain their original colors. */
export function BrandMark({
  inverse = false,
  compact = false,
}: {
  inverse?: boolean;
  compact?: boolean;
}) {
  const { brandConfig, resolvedTheme } = useBrandConfig();
  const logo =
    resolvedTheme === 'dark'
      ? (brandConfig.logoDarkUrl ?? brandConfig.logoUrl)
      : brandConfig.logoUrl;
  const locale = useLocale();
  return (
    <span className="inline-flex min-w-0 items-center gap-3">
      {logo ? (
        <>
          <picture className={brandConfig.logoUrl ? 'print:hidden' : undefined}>
            <img data-slot="brand-logo" src={logo} alt="" className="h-9 max-w-24 object-contain" />
          </picture>
          {brandConfig.logoUrl && (
            <img
              data-slot="brand-logo-print"
              fetchPriority="low"
              src={brandConfig.logoUrl}
              alt=""
              className="hidden h-9 max-w-24 object-contain print:block"
            />
          )}
        </>
      ) : (
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            inverse ? 'bg-energy text-brand-panel' : 'bg-primary text-primary-foreground'
          )}
        >
          <Zap className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </span>
      )}
      <span className={compact ? 'sr-only' : 'truncate text-xl font-semibold tracking-tight'}>
        {brandName(brandConfig, locale)}
      </span>
    </span>
  );
}
