import { useSyncExternalStore } from 'react'
import type { Locale } from '@barghsa/i18n/auth'

function readLocale(): Locale {
  if (typeof document === 'undefined') return 'fa'
  return document.documentElement.lang.toLowerCase().split('-')[0] === 'en' ? 'en' : 'fa'
}
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  return () => observer.disconnect()
}

/** Subscribe to the shared document locale, including live language changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, readLocale, () => 'fa')
}
