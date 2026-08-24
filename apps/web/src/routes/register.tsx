import { useState, useCallback } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import { Button, Checkbox, Input, Label } from '@barghsa/ui'
import { AuthLayout } from '../components/AuthLayout.js'
import { PasswordField } from '../components/PasswordField.js'

export const Route = createFileRoute('/register')({
  component: RegisterPage,
})

// ─── Iranian mobile number helpers ──────────────────────────────────────

/** Regex: starts with 09, followed by exactly 9 digits (11 total) */
const IRANIAN_MOBILE_RE = /^09\d{9}$/

/** Regex: basic email validation */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Regex: loose E.164 — starts with +, 7-15 digits */
const E164_RE = /^\+[1-9]\d{6,14}$/

type UsernameType = 'email' | 'mobile' | 'international' | null

interface NormalizationResult {
  type: UsernameType
  normalized: string
  formatted: string | null
}

/**
 * Detect the type of the raw input and normalize it.
 * Returns { type, normalized, formatted }.
 * - type=null means invalid/unrecognised.
 * - formatted is the display-friendly version (e.g. "+98 912 123 4567").
 */
function normalizeUsername(raw: string): NormalizationResult {
  const trimmed = raw.trim()

  // Iranian mobile: 09121234567 → +989121234567
  if (IRANIAN_MOBILE_RE.test(trimmed)) {
    const e164 = `+98${trimmed.slice(1)}` // 09XXXXXXXXX → +989XXXXXXXX
    const groups = e164.match(/^(\+\d{2})(\d{3})(\d{3})(\d{4})$/)
    const formatted = groups
      ? `${groups[1]} ${groups[2]} ${groups[3]} ${groups[4]}`
      : e164
    return { type: 'mobile', normalized: e164, formatted }
  }

  // International (already E.164)
  if (trimmed.startsWith('+')) {
    if (E164_RE.test(trimmed)) {
      return { type: 'international', normalized: trimmed, formatted: null }
    }
    return { type: null, normalized: trimmed, formatted: null }
  }

  // Email
  if (EMAIL_RE.test(trimmed)) {
    return { type: 'email', normalized: trimmed.toLowerCase(), formatted: null }
  }

  return { type: null, normalized: trimmed, formatted: null }
}

// ─── Page component ──────────────────────────────────────────────────────

function RegisterPage() {
  const locale: Locale = 'fa' // TODO: read from user preference / locale context

  const [username, setUsername] = useState('')
  const [usernameError, setUsernameError] = useState<string | null>(null)
  const [usernameType, setUsernameType] = useState<UsernameType>(null)
  const [formattedHint, setFormattedHint] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [tosAccepted, setTosAccepted] = useState(false)
  const [tosSubmittedError, setTosSubmittedError] = useState<string | null>(null)

  const isUsernameValid = touched && usernameError === null && usernameType !== null

  const handleBlur = useCallback(() => {
    setTouched(true)
    const result = normalizeUsername(username)

    if (!username.trim()) {
      setUsernameError(t('error.validation.input.missing', locale))
      setUsernameType(null)
      setFormattedHint(null)
      return
    }

    if (result.type === null) {
      setUsernameError(t('auth.register.invalidUsername', locale))
      setUsernameType(null)
      setFormattedHint(null)
      return
    }

    if (result.type === 'email' && !EMAIL_RE.test(result.normalized)) {
      setUsernameError(t('auth.register.invalidEmail', locale))
      setUsernameType(null)
      setFormattedHint(null)
      return
    }

    // Valid
    setUsernameError(null)
    setUsernameType(result.type)
    setFormattedHint(result.formatted)
  }, [username, locale])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (val.length > 255) return
    setUsername(val)
    if (touched) {
      // Re-validate on change after first blur
      const result = normalizeUsername(val)
      if (!val.trim()) {
        setUsernameError(t('error.validation.input.missing', locale))
        setUsernameType(null)
        setFormattedHint(null)
      } else if (result.type === null) {
        setUsernameError(t('auth.register.invalidUsername', locale))
        setUsernameType(null)
        setFormattedHint(null)
      } else {
        setUsernameError(null)
        setUsernameType(result.type)
        setFormattedHint(result.formatted)
      }
    }
  }, [touched, locale])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!tosAccepted) {
      setTosSubmittedError(t('auth.register.tosRequired', locale))
      return
    }
    setTosSubmittedError(null)
    // TODO: Submit registration (T-01.01.06)
  }, [tosAccepted, locale])

  const handleTosChange = useCallback((checked: boolean | string) => {
    const isChecked = checked === true
    setTosAccepted(isChecked)
    if (isChecked) {
      setTosSubmittedError(null)
    }
  }, [])

  const isFormReady = isUsernameValid && tosAccepted

  return (
    <AuthLayout
      locale={locale}
      footer={
        <p className="text-center text-sm text-muted-foreground">
          {t('auth.register.loginLink', locale)}{' '}
          <Link
            to="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
            aria-label={t('auth.register.loginLinkLabel', locale)}
          >
            {t('auth.register.loginLinkLabel', locale)}
          </Link>
        </p>
      }
    >
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            {t('auth.register.title', locale)}
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
          noValidate
        >
          {/* Unified username field */}
          <div className="space-y-2">
            <Label htmlFor="username">
              {t('auth.register.emailLabel', locale)}
            </Label>
            <Input
              id="username"
              type="text"
              placeholder={t('auth.register.usernamePlaceholder', locale)}
              autoComplete="username"
              autoFocus
              maxLength={255}
              value={username}
              onChange={handleChange}
              onBlur={handleBlur}
              aria-invalid={touched && usernameError !== null}
              aria-describedby={
                usernameError
                  ? 'username-error'
                  : formattedHint
                    ? 'username-hint'
                    : undefined
              }
            />
            {/* Error message */}
            {touched && usernameError && (
              <p
                id="username-error"
                className="text-sm text-destructive"
                role="alert"
              >
                {usernameError}
              </p>
            )}
            {/* Formatted mobile hint */}
            {touched && !usernameError && formattedHint && (
              <p
                id="username-hint"
                className="text-sm text-muted-foreground"
              >
                {formattedHint}
              </p>
            )}
          </div>

          {/* Password field with visibility toggle and strength meter */}
          {isUsernameValid && (
            <PasswordField
              id="password"
              label={t('auth.register.passwordLabel', locale)}
              locale={locale}
              autoFocus={false}
            />
          )}

          {/* TOS acceptance checkbox (T-01.01.04) */}
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <Checkbox
                id="tos"
                checked={tosAccepted}
                onCheckedChange={handleTosChange}
                aria-invalid={!!tosSubmittedError}
                aria-describedby={tosSubmittedError ? 'tos-error' : undefined}
                className="mt-0.5"
              />
              <Label htmlFor="tos" className="text-sm font-normal leading-relaxed">
                {t('auth.register.tosPrefix', locale)}{' '}
                <Link
                  to="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
                  aria-label={t('auth.register.tosLinkText', locale)}
                >
                  {t('auth.register.tosLinkText', locale)}
                </Link>{' '}
                {t('auth.register.tosSuffix', locale)}
              </Label>
            </div>
            {tosSubmittedError && (
              <p
                id="tos-error"
                className="text-sm text-destructive"
                role="alert"
              >
                {tosSubmittedError}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={!isFormReady}
          >
            {t('auth.register.submit', locale)}
          </Button>
        </form>

        {/* Placeholder for OTP step (T-01.02.02) */}
      </div>
    </AuthLayout>
  )
}