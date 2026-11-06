import { useLocale } from './useLocale.js';

/** Follow the current locale, including changes while the page is open. */
export function useDirection() {
  const dir = useLocale() === 'fa' ? 'rtl' : 'ltr';
  return { dir, isRtl: dir === 'rtl', isLtr: dir === 'ltr' } as const;
}
