import { useState, useEffect, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import {
  UserIcon,
  MailIcon,
  PhoneIcon,
  AlertCircleIcon,
  Loader2Icon,
  KeyIcon,
  PlusIcon,
  SendIcon,
  CheckIcon,
  XIcon,
} from 'lucide-react'
import { Button, Input, Label, Alert, AlertTitle, AlertDescription } from '@barghsa/ui'
import { withCsrf } from '../../../lib/csrf.js'
import { useLocale } from '../../../hooks/useLocale.js'

export const Route = createFileRoute('/_app/settings/username')({
  component: SettingsUsernamePage,
})

// ─── Types ────────────────────────────────────────────────────────────

interface UserInfo {
  userId: string
  username: string
  email: string | null
  mobile: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Mask a username for display. Shows first 3 chars and last 3 chars with dots.
 */
function maskUsername(username: string): string {
  if (username.length <= 8) {
    return username.slice(0, 3) + '***' + username.slice(-3)
  }
  return username.slice(0, 3) + '...' + username.slice(-3)
}

/**
 * Determine if a username is an email.
 */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

// ─── Page Component ────────────────────────────────────────────────────

function SettingsUsernamePage() {
  const locale = useLocale()

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Change username state
  const [showChangeUsername, setShowChangeUsername] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [changeOtpSent, setChangeOtpSent] = useState(false)
  const [changeChallengeId, setChangeChallengeId] = useState('')
  const [changeOtp, setChangeOtp] = useState('')
  const [sendingChangeOtp, setSendingChangeOtp] = useState(false)
  const [verifyingChange, setVerifyingChange] = useState(false)

  // Add contact state
  const [showAddContact, setShowAddContact] = useState<'email' | 'mobile' | null>(null)
  const [newContactValue, setNewContactValue] = useState('')
  const [contactOtpSent, setContactOtpSent] = useState(false)
  const [contactChallengeId, setContactChallengeId] = useState('')
  const [contactOtp, setContactOtp] = useState('')
  const [sendingContactOtp, setSendingContactOtp] = useState(false)
  const [verifyingContact, setVerifyingContact] = useState(false)

  // ── Fetch user info ──────────────────────────────────────────────────

  const fetchUserInfo = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/user')
      if (!response.ok) {
        setError(t('settings.profile.error.load', locale))
        return
      }

      const data: UserInfo = await response.json()
      setUserInfo(data)
    } catch {
      setError(t('settings.profile.error.loadRetry', locale))
    } finally {
      setLoading(false)
    }
  }, [locale])

  useEffect(() => {
    fetchUserInfo()
  }, [fetchUserInfo])

  // ── Change username OTP send ─────────────────────────────────────────

  const handleSendChangeOtp = useCallback(async () => {
    if (!newUsername.trim()) return

    setSendingChangeOtp(true)

    try {
      const response = await fetch('/api/auth/change-username/send-otp', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ newUsername: newUsername.trim() }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const code = (body as { error?: string }).error

        if (code === 'AUTH:CHANGE_USERNAME:SAME') {
          toast.error(t('settings.username.error.same', locale))
        } else if (code === 'AUTH:CHANGE_USERNAME:TAKEN') {
          toast.error(t('settings.username.error.taken', locale))
        } else if (code === 'AUTH:CHANGE_USERNAME:INVALID') {
          toast.error(t('settings.username.error.invalid', locale))
        } else {
          toast.error(t('settings.username.error.generic', locale))
        }
        return
      }

      const data = await response.json()
      setChangeChallengeId(data.challengeId)
      setChangeOtpSent(true)
      toast.success(t('settings.username.otpSent', locale).replace('{destination}', newUsername.trim()))
    } catch {
      toast.error(t('settings.username.error.generic', locale))
    } finally {
      setSendingChangeOtp(false)
    }
  }, [newUsername, locale])

  // ── Change username OTP verify ───────────────────────────────────────

  const handleVerifyChange = useCallback(async () => {
    if (!changeOtp.trim() || changeOtp.length !== 6) return

    setVerifyingChange(true)

    try {
      const response = await fetch('/api/auth/change-username', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          newUsername: newUsername.trim(),
          otpChallengeId: changeChallengeId,
          otp: changeOtp.trim(),
        }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const code = (body as { error?: string }).error

        if (code === 'AUTH:CHANGE_USERNAME:TAKEN') {
          toast.error(t('settings.username.error.taken', locale))
        } else {
          toast.error(t('settings.username.error.generic', locale))
        }
        return
      }

      toast.success(t('settings.username.success', locale))

      // Reset form
      setShowChangeUsername(false)
      setNewUsername('')
      setChangeOtpSent(false)
      setChangeChallengeId('')
      setChangeOtp('')

      // Refresh user info
      fetchUserInfo()
    } catch {
      toast.error(t('settings.username.error.generic', locale))
    } finally {
      setVerifyingChange(false)
    }
  }, [newUsername, changeChallengeId, changeOtp, locale, fetchUserInfo])

  // ── Add contact OTP send ─────────────────────────────────────────────

  const handleSendContactOtp = useCallback(async () => {
    if (!showAddContact || !newContactValue.trim()) return

    setSendingContactOtp(true)

    try {
      const response = await fetch('/api/auth/add-contact/send-otp', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          contactType: showAddContact,
          contactValue: newContactValue.trim(),
        }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const code = (body as { error?: string }).error

        if (code === 'AUTH:CHANGE_USERNAME:ALREADY_HAS_EMAIL') {
          toast.error(t('settings.contact.error.alreadyHasEmail', locale))
        } else if (code === 'AUTH:CHANGE_USERNAME:ALREADY_HAS_MOBILE') {
          toast.error(t('settings.contact.error.alreadyHasMobile', locale))
        } else {
          toast.error(t('settings.contact.error.generic', locale))
        }
        return
      }

      const data = await response.json()
      setContactChallengeId(data.challengeId)
      setContactOtpSent(true)
      toast.success(t('settings.contact.otpSent', locale).replace('{destination}', newContactValue.trim()))
    } catch {
      toast.error(t('settings.contact.error.generic', locale))
    } finally {
      setSendingContactOtp(false)
    }
  }, [showAddContact, newContactValue, locale])

  // ── Add contact OTP verify ───────────────────────────────────────────

  const handleVerifyContact = useCallback(async () => {
    if (!showAddContact || !contactOtp.trim() || contactOtp.length !== 6) return

    setVerifyingContact(true)

    try {
      const response = await fetch('/api/auth/add-contact', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          contactType: showAddContact,
          contactValue: newContactValue.trim(),
          otpChallengeId: contactChallengeId,
          otp: contactOtp.trim(),
        }),
      })

      if (!response.ok) {
        toast.error(t('settings.contact.error.generic', locale))
        return
      }

      toast.success(t('settings.contact.success', locale))

      // Reset form
      setShowAddContact(null)
      setNewContactValue('')
      setContactOtpSent(false)
      setContactChallengeId('')
      setContactOtp('')

      // Refresh user info
      fetchUserInfo()
    } catch {
      toast.error(t('settings.contact.error.generic', locale))
    } finally {
      setVerifyingContact(false)
    }
  }, [showAddContact, newContactValue, contactChallengeId, contactOtp, locale, fetchUserInfo])

  // ── Cancel change username ───────────────────────────────────────────

  const handleCancelChange = useCallback(() => {
    setShowChangeUsername(false)
    setNewUsername('')
    setChangeOtpSent(false)
    setChangeChallengeId('')
    setChangeOtp('')
  }, [])

  // ── Cancel add contact ───────────────────────────────────────────────

  const handleCancelContact = useCallback(() => {
    setShowAddContact(null)
    setNewContactValue('')
    setContactOtpSent(false)
    setContactChallengeId('')
    setContactOtp('')
  }, [])

  // ── Render ──────────────────────────────────────────────────────────

  const usernameType = userInfo ? (isEmail(userInfo.username) ? 'email' : 'mobile') : null

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>

      {/* Title */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('settings.username.title', locale)}</h1>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-8 text-muted-foreground">
          <UserIcon className="mx-auto h-6 w-6 animate-pulse mb-2" />
          <p className="text-sm">{t('settings.profile.loading', locale)}</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="h-4 w-4" />
          <AlertTitle>{t('settings.security.error.title', locale)}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Content */}
      {!loading && !error && userInfo && (
        <div className="space-y-8">

          {/* ── Current Username Section ──────────────────────────────── */}
          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyIcon className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">{t('settings.username.current', locale)}</h2>
              </div>
              {!showChangeUsername && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowChangeUsername(true)}
                  className="gap-1"
                >
                  <KeyIcon className="h-3.5 w-3.5" />
                  {t('settings.username.change', locale)}
                </Button>
              )}
            </div>

            <p className="text-sm font-mono text-muted-foreground">
              {maskUsername(userInfo.username)}
            </p>

            {/* Change Username Form */}
            {showChangeUsername && (
              <div className="space-y-3 pt-2 border-t">
                {!changeOtpSent ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-username" className="text-xs">
                        {t('settings.username.newLabel', locale)}
                      </Label>
                      <Input
                        id="new-username"
                        placeholder={t('settings.username.newPlaceholder', locale)}
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        className="text-sm"
                        dir="ltr"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelChange}
                        className="gap-1"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                        {t('settings.contact.cancel', locale)}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSendChangeOtp}
                        disabled={sendingChangeOtp || !newUsername.trim()}
                        className="gap-1"
                      >
                        {sendingChangeOtp ? (
                          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <SendIcon className="h-3.5 w-3.5" />
                        )}
                        {t('settings.contact.sendOtp', locale)}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.username.otpSent', locale).replace('{destination}', newUsername)}
                    </p>
                    <div className="space-y-1.5">
                      <Label htmlFor="change-otp" className="text-xs">
                        {t('settings.username.otpLabel', locale)}
                      </Label>
                      <Input
                        id="change-otp"
                        placeholder={t('settings.username.otpPlaceholder', locale)}
                        value={changeOtp}
                        onChange={(e) => setChangeOtp(e.target.value)}
                        maxLength={6}
                        className="text-sm font-mono w-40"
                        dir="ltr"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelChange}
                        className="gap-1"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                        {t('settings.contact.cancel', locale)}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleVerifyChange}
                        disabled={verifyingChange || changeOtp.length !== 6}
                        className="gap-1"
                      >
                        {verifyingChange ? (
                          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckIcon className="h-3.5 w-3.5" />
                        )}
                        {t('settings.contact.verify', locale)}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Contact Information Section ───────────────────────────── */}
          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center gap-2">
              <MailIcon className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">{t('settings.contact.title', locale)}</h2>
            </div>

            {/* Email */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MailIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm">{t('settings.contact.email', locale)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-muted-foreground">
                  {userInfo.email ?? (locale === 'fa' ? 'ثبت نشده' : 'Not set')}
                </span>
                {!userInfo.email && usernameType !== 'email' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddContact('email')}
                    className="gap-1 text-xs"
                  >
                    <PlusIcon className="h-3 w-3" />
                    {t('settings.contact.addEmail', locale)}
                  </Button>
                )}
              </div>
            </div>

            {/* Mobile */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PhoneIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm">{t('settings.contact.mobile', locale)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-muted-foreground">
                  {userInfo.mobile ?? (locale === 'fa' ? 'ثبت نشده' : 'Not set')}
                </span>
                {!userInfo.mobile && usernameType !== 'mobile' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddContact('mobile')}
                    className="gap-1 text-xs"
                  >
                    <PlusIcon className="h-3 w-3" />
                    {t('settings.contact.addMobile', locale)}
                  </Button>
                )}
              </div>
            </div>

            {/* Add Contact Form */}
            {showAddContact && (
              <div className="space-y-3 pt-2 border-t">
                {!contactOtpSent ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-contact" className="text-xs">
                        {showAddContact === 'email'
                          ? t('settings.contact.email', locale)
                          : t('settings.contact.mobile', locale)
                        }
                      </Label>
                      <Input
                        id="new-contact"
                        placeholder={
                          showAddContact === 'email'
                            ? t('settings.contact.newEmailPlaceholder', locale)
                            : t('settings.contact.newMobilePlaceholder', locale)
                        }
                        value={newContactValue}
                        onChange={(e) => setNewContactValue(e.target.value)}
                        className="text-sm"
                        dir="ltr"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelContact}
                        className="gap-1"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                        {t('settings.contact.cancel', locale)}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSendContactOtp}
                        disabled={sendingContactOtp || !newContactValue.trim()}
                        className="gap-1"
                      >
                        {sendingContactOtp ? (
                          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <SendIcon className="h-3.5 w-3.5" />
                        )}
                        {t('settings.contact.sendOtp', locale)}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.contact.otpSent', locale).replace('{destination}', newContactValue)}
                    </p>
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-otp" className="text-xs">
                        {t('settings.contact.otpLabel', locale)}
                      </Label>
                      <Input
                        id="contact-otp"
                        placeholder={t('settings.contact.otpPlaceholder', locale)}
                        value={contactOtp}
                        onChange={(e) => setContactOtp(e.target.value)}
                        maxLength={6}
                        className="text-sm font-mono w-40"
                        dir="ltr"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelContact}
                        className="gap-1"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                        {t('settings.contact.cancel', locale)}
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleVerifyContact}
                        disabled={verifyingContact || contactOtp.length !== 6}
                        className="gap-1"
                      >
                        {verifyingContact ? (
                          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckIcon className="h-3.5 w-3.5" />
                        )}
                        {t('settings.contact.verify', locale)}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}