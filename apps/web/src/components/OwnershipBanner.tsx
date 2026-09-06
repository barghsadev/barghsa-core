import { useEffect, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { t } from '@barghsa/i18n'
import { useLocale } from '../hooks/useLocale.js'

export function OwnershipBanner() {
  const locale = useLocale()
  const { pathname } = useLocation()
  const [pending, setPending] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/profiles/ownership-transfers', { credentials: 'include', signal: controller.signal })
      .then(async response => { if (response.ok) return response.json(); return null })
      .then(data => { if (!controller.signal.aborted) setPending(data?.transfers?.some((item: { direction: string }) => item.direction === 'incoming') ?? false) })
      .catch(() => { if (!controller.signal.aborted) setPending(false) })
    return () => controller.abort()
  }, [pathname])
  if (!pending || pathname === '/settings/team') return null
  return <div className="border-b border-blue-200 bg-blue-50 px-4 py-3 text-sm" role="status">
    <Link to="/settings/team" className="text-blue-900 underline">{t('team.banner', locale)}</Link>
  </div>
}
