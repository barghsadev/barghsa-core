import { useLocale } from './useLocale.js';

/** Follow the current locale, including changes while the page is open. */
export function useDirection(): 'rtl' | 'ltr' {
  return useLocale() === 'fa' ? 'rtl' : 'ltr';
}
