import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { t } from '@barghsa/i18n'
import { Button, Input, Label, DatePicker } from '@barghsa/ui'
import { useLocale } from '../hooks/useLocale.js'
interface User {
  userId: string; username: string; registrationDate: string; lastLogin: string | null
  profileCount: number; hasVerifiedProfile: boolean
  profiles: { id: string; profileType: string; status: string; title: string | null }[]
}
const emptyFilters = { type: '', verification: '', dateFrom: '', dateTo: '', order: 'desc', staffOnly: false }
export default function CrmProfileList() {
  const locale = useLocale()
  const search = useSearch({ from: '/admin/crm/' })
  const [filters, setFilters] = useState({ ...emptyFilters, verification: ['VERIFIED','UNVERIFIED','PENDING','DISABLED'].includes(search.verification ?? '') ? search.verification! : '' })
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [cursors, setCursors] = useState<string[]>([''])
  const [result, setResult] = useState<{ users: User[]; cursor: string | null; hasMore: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const generation = useRef(0)
  useEffect(() => { if (text.trim() === term) return; const timer = setTimeout(() => { setTerm(text.trim()); setCursors(['']) }, 300); return () => clearTimeout(timer) }, [text, term])
  const cursor = cursors.at(-1) ?? ''
  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true); setError(false); setResult(null); setExpanded({})
    const params = new URLSearchParams({ limit: '20', order: filters.order })
    for (const [key, value] of Object.entries({ ...filters, search: term, cursor })) {
      if (value) params.set(key, String(value))
    }
    // Inclusive final day, independent of the browser's local time zone.
    if (filters.dateTo) params.set('dateTo', `${filters.dateTo}T23:59:59.999999Z`)
    try {
      const response = await fetch(`/api/crm/users?${params}`, { credentials: 'include' })
      if (!response.ok) throw new Error('CRM unavailable')
      const data = await response.json()
      if (!Array.isArray(data.users)) throw new Error('Invalid CRM response')
      if (current === generation.current) setResult(data)
    } catch { if (current === generation.current) setError(true) }
    finally { if (current === generation.current) setLoading(false) }
  }, [filters, term, cursor])
  useEffect(() => { void load(); return () => { ++generation.current } }, [load])
  function update(key: keyof typeof filters, value: string | boolean) { setFilters(previous => ({ ...previous, [key]: value })); setCursors(['']) }
  function date(value: string | null) { return value ? new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : '—' }
  return <section className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
    <h1 className="text-2xl font-semibold">{t('crm.list.title', locale)}</h1>
    <div className="grid gap-4 rounded-lg border bg-white p-4 sm:grid-cols-2 xl:grid-cols-3">
      <div><Label htmlFor="crm-search">{t('crm.list.search', locale)}</Label><Input id="crm-search" value={text} onChange={event => setText(event.target.value)} /></div>
      {([{ key: 'type', options: ['', 'INDIVIDUAL','LEGAL'] }, { key: 'verification', options: ['', 'VERIFIED','UNVERIFIED','PENDING','DISABLED'] }, { key: 'order', options: ['desc','asc'] }] as const).map(({key,options}) =>
        <div key={key}><Label htmlFor={`crm-${key}`}>{t(`crm.list.${key}`, locale)}</Label>
          <select id={`crm-${key}`} className="block w-full rounded border p-2" value={filters[key]} onChange={event => update(key,event.target.value)}>
            {options.map(value => <option key={value} value={value}>{t(`crm.list.${value || 'all'}`, locale)}</option>)}
          </select></div>)}
      {(['dateFrom','dateTo'] as const).map(key => <div key={key}><Label htmlFor={`crm-${key}`}>{t(`crm.list.${key === 'dateFrom' ? 'from' : 'to'}`, locale)}</Label><DatePicker id={`crm-${key}`} label={t(`crm.list.${key === 'dateFrom' ? 'from' : 'to'}`, locale)} placeholder={t(`crm.list.${key === 'dateFrom' ? 'from' : 'to'}`, locale)} jalali={locale === 'fa'}
        {...(filters[key] ? { value: new Date(`${filters[key]}T12:00:00`) } : {})}
        onChange={value => update(key, value ? `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}` : '')} /></div>)}
      <Label className="flex items-center gap-2"><input type="checkbox" checked={filters.staffOnly} onChange={event => update('staffOnly',event.target.checked)} />{t('crm.list.staffOnly', locale)}</Label>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => { setFilters(emptyFilters); setText(''); setTerm(''); setCursors(['']) }}>{t('crm.list.clear', locale)}</Button>
      <Button variant="outline" onClick={() => setExpanded({})}>{t('crm.list.collapse', locale)}</Button>
      <Button variant="outline" disabled={loading} onClick={() => void load()}>{t('crm.list.refresh', locale)}</Button>
    </div>
    <div className="flex flex-wrap gap-2">{Object.entries(filters).filter(([key,value]) => value && key !== 'order').map(([key,value]) =>
      <Button key={key} variant="outline" size="sm" onClick={() => update(key as keyof typeof filters,key==='staffOnly'?false:'')}>
        {t(`crm.list.${key==='staffOnly'?'staffOnly':key==='dateFrom'?'from':key==='dateTo'?'to':String(value)}`,locale)}{key==='dateFrom'||key==='dateTo'?`: ${value}`:''} ×
      </Button>)}</div>
    {loading ? <p role="status">{t('crm.list.loading', locale)}</p> : error ? <p role="alert">{t('crm.list.error', locale)}</p> : !result?.users.length ? <p>{t('crm.list.empty', locale)}</p> :
      <ul className="space-y-3">{result.users.map(user => <li key={user.userId} className="rounded-lg border bg-white p-4 space-y-3 break-words">
        <h2 className="font-semibold" dir="auto">{user.username}</h2>
        <p className="text-sm text-gray-600">{Array.from(new Set(user.profiles.map(profile => profile.profileType))).map(type => t(`crm.list.${type}`,locale)).join(' · ')}</p>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div><dt>{t('crm.list.registered', locale)}</dt><dd>{date(user.registrationDate)}</dd></div>
          <div><dt>{t('crm.list.lastLogin', locale)}</dt><dd>{date(user.lastLogin)}</dd></div>
          <div><dt>{t('crm.list.verification', locale)}</dt><dd>{t(`crm.list.${user.hasVerifiedProfile?'VERIFIED':user.profiles.some(profile => profile.status==='PENDING_VERIFICATION')?'PENDING':'UNVERIFIED'}`,locale)}</dd></div>
        </dl>
        <Button variant="outline" aria-expanded={!!expanded[user.userId]} aria-controls={`profiles-${user.userId}`} onClick={() => setExpanded(previous => ({ ...previous, [user.userId]: !previous[user.userId] }))}>{t('crm.list.profiles',locale)}: {user.profileCount}</Button>
        {expanded[user.userId] && <ul id={`profiles-${user.userId}`} className="space-y-2">{user.profiles.map(profile => <li key={profile.id}>
          <a className="text-blue-700 underline" href={`/admin/crm/profiles/${encodeURIComponent(profile.id)}`}>{profile.title || t(`crm.list.${profile.profileType}`,locale)} · {t('crm.list.view',locale)}</a>
          <span className="ms-2 text-sm">{t(`crm.list.${profile.status}`,locale)}</span>
        </li>)}</ul>}
      </li>)}</ul>}
    <nav aria-label={t('crm.list.title',locale)} className="flex gap-2">
      <Button variant="outline" disabled={loading || cursors.length===1} onClick={() => setCursors(previous => previous.slice(0,-1))}>{t('crm.list.previous',locale)}</Button>
      <Button variant="outline" disabled={loading || error || !result?.hasMore || !result.cursor} onClick={() => { if(result?.cursor) setCursors(previous => [...previous,result.cursor!]) }}>{t('crm.list.next',locale)}</Button>
    </nav>
  </section>
}
