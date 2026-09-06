import { useRef, useState, type FormEvent } from 'react'
import { t } from '@barghsa/i18n'
import { ErrorCodes } from '@barghsa/shared/errors'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Input, Label } from '@barghsa/ui'
import { useLocale } from '../hooks/useLocale.js'
import { withCsrf } from '../lib/csrf.js'

export interface TeamAction {
  title: string
  description: string
  path: string
  method: 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  signsOut?: boolean
  conflictMessage?: string
  forbiddenMessage?: string
  errorMessages?: Record<string, string>
}

/** The action is captured when opened; password verification retries that same action. */
export function TeamActionDialog({ action, onClose, onSuccess }: {
  action: TeamAction; onClose: () => void; onSuccess: () => Promise<void>
}) {
  const locale = useLocale()
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      if (needsPassword) {
        const verified = await fetch('/api/auth/step-up', { method: 'POST', credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }), body: JSON.stringify({ password }) })
        setPassword('')
        if (!verified.ok) { setError(t('team.passwordError', locale)); return }
      }
      const response = await fetch(action.path, { method: action.method, credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        ...(action.body === undefined ? {} : { body: JSON.stringify(action.body) }) })
      const data = await response.json().catch(() => null)
      const code = typeof data?.error === 'string' ? data.error : data?.error?.code
      if (response.status === 403 && (code === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code || data?.requiresStepUp === true)) {
        setNeedsPassword(true)
        return
      }
      if (!response.ok) {
        setError(action.errorMessages?.[code] ?? (response.status === 409 ? action.conflictMessage ?? t('team.conflict', locale) : response.status === 403 ? action.forbiddenMessage ?? t('team.forbidden', locale) : t('team.error', locale)))
        return
      }
      if (action.signsOut) { window.location.assign('/login'); return }
      await onSuccess()
      onClose()
    } catch { setError(t('team.error', locale)) }
    finally { inFlight.current = false; setBusy(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !inFlight.current) onClose() }}>
    <DialogContent showCloseButton={!busy} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <form onSubmit={submit} className="space-y-4">
        <DialogHeader><DialogTitle>{action.title}</DialogTitle><DialogDescription>{action.description}</DialogDescription></DialogHeader>
        {needsPassword && <div className="space-y-2">
          <Label htmlFor="team-step-up-password">{t('team.password', locale)}</Label>
          <Input id="team-step-up-password" type="password" autoComplete="current-password" required autoFocus
            value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
        </div>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('team.cancel', locale)}</Button>
          <Button type="submit" disabled={busy || (needsPassword && !password)}>{t(busy ? 'team.working' : 'team.confirm', locale)}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
