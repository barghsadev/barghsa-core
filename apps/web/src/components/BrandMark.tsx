import { Zap } from 'lucide-react';
import { cn } from '@barghsa/ui';
import { useBrandConfig } from '../providers/BrandThemeProvider.js';

/** The same mark in every shell; configured logos retain their original colors. */
export function BrandMark({ inverse = false }: { inverse?: boolean }) {
  const { brandConfig } = useBrandConfig();
  return (
    <span className="inline-flex min-w-0 items-center gap-3">
      {brandConfig.logoUrl ? (
        <img src={brandConfig.logoUrl} alt="" className="h-9 max-w-24 object-contain" />
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
      <span className="truncate text-xl font-semibold tracking-tight">{brandConfig.appTitle}</span>
    </span>
  );
}
