import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';

/** Offset pagination only. The caller owns fetching, total counts and translated labels. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  label,
  previousLabel,
  nextLabel,
  pageLabel,
  formatPage = String,
  disabled = false,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  label: string;
  previousLabel: string;
  nextLabel: string;
  pageLabel: (page: number) => string;
  formatPage?: (page: number) => string;
  disabled?: boolean;
}) {
  const count = Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : 1;
  const current = Number.isSafeInteger(page) ? Math.min(count, Math.max(1, page)) : 1;
  const pages = [...new Set([1, current - 1, current, current + 1, count])]
    .filter((p) => p >= 1 && p <= count)
    .sort((a, b) => a - b);
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        disabled={disabled || current === 1}
        aria-label={previousLabel}
        onClick={() => onPageChange(current - 1)}
      >
        <ChevronLeft className="rtl:rotate-180" aria-hidden="true" />
      </Button>
      {pages.map((p, index) => (
        <span key={p} className="inline-flex items-center gap-1">
          {index > 0 && p - pages[index - 1]! > 1 ? (
            <span aria-hidden="true" className="px-1 text-muted-foreground">
              …
            </span>
          ) : null}
          <Button
            variant={p === current ? 'default' : 'ghost'}
            size="icon"
            disabled={disabled}
            aria-current={p === current ? 'page' : undefined}
            aria-label={pageLabel(p)}
            onClick={() => {
              if (p !== current) onPageChange(p);
            }}
          >
            {formatPage(p)}
          </Button>
        </span>
      ))}
      <Button
        variant="outline"
        size="icon"
        disabled={disabled || current === count}
        aria-label={nextLabel}
        onClick={() => onPageChange(current + 1)}
      >
        <ChevronRight className="rtl:rotate-180" aria-hidden="true" />
      </Button>
    </nav>
  );
}
