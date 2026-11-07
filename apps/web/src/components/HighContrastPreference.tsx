import { useState } from 'react';
import { useLocale } from '../hooks/useLocale.js';

const copy = {
  en: {
    title: 'High contrast',
    description: 'Use stronger colors for text, borders and controls on this browser.',
  },
  fa: {
    title: 'کنتراست بالا',
    description: 'در این مرورگر، متن‌ها، حاشیه‌ها و کنترل‌ها را با کنتراست بیشتری نمایش بده.',
  },
} as const;

export function HighContrastPreference() {
  const label = copy[useLocale()];
  const [enabled, setEnabled] = useState(
    () => document.documentElement.dataset.contrast === 'more'
  );
  function change(next: boolean) {
    if (next) document.documentElement.dataset.contrast = 'more';
    else delete document.documentElement.dataset.contrast;
    setEnabled(next);
    try {
      if (next) localStorage.setItem('barghsa.contrast', 'more');
      else localStorage.removeItem('barghsa.contrast');
    } catch {
      // The preference remains applied to the current page.
    }
  }
  return (
    <label className="touch-label flex items-center justify-between gap-4 rounded-lg border p-3">
      <span className="min-w-0 space-y-1">
        <span id="high-contrast-label" className="block font-medium">
          {label.title}
        </span>
        <span id="high-contrast-help" className="block text-sm text-muted-foreground">
          {label.description}
        </span>
      </span>
      <input
        className="size-5 shrink-0 accent-primary"
        type="checkbox"
        role="switch"
        checked={enabled}
        aria-labelledby="high-contrast-label"
        aria-describedby="high-contrast-help"
        onChange={(event) => change(event.target.checked)}
      />
    </label>
  );
}
