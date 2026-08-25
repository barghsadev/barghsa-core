import { type Locale, t } from '@barghsa/i18n'
import { Input, Label, Progress, ProgressIndicator, ProgressTrack } from '@barghsa/ui'
import { type ReactNode, useCallback, useState } from 'react'

// ─── Password strength evaluation ────────────────────────────────────────

export type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong'

interface StrengthResult {
  /** 0-100 score for the progress bar */
  score: number
  /** Human-readable level */
  level: StrengthLevel
}

/**
 * Evaluate password strength locally.
 * Scores length, character-class diversity, and extra length bonuses.
 * No data is sent to any third party.
 */
export function evaluateStrength(password: string): StrengthResult {
  if (!password) return { score: 0, level: 'weak' }

  const len = password.length

  // Length score: up to 40 points (40 chars = max)
  let score = Math.min(len * 2, 40)

  // Character-class diversity: 15 points each
  if (/[a-z]/.test(password)) score += 15
  if (/[A-Z]/.test(password)) score += 15
  if (/\d/.test(password)) score += 15

  // Bonus for mixing multiple character classes
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length
  if (classes >= 3) score += 5
  if (classes >= 4) score += 10

  // Clamp to 0-100
  const clamped = Math.min(Math.max(score, 0), 100)

  let level: StrengthLevel
  if (clamped < 25) level = 'weak'
  else if (clamped < 50) level = 'fair'
  else if (clamped < 75) level = 'good'
  else level = 'strong'

  return { score: clamped, level }
}

const STRENGTH_LABEL_KEYS: Record<StrengthLevel, string> = {
  weak: 'auth.register.passwordStrengthWeak',
  fair: 'auth.register.passwordStrengthFair',
  good: 'auth.register.passwordStrengthGood',
  strong: 'auth.register.passwordStrengthStrong',
}

const STRENGTH_BAR_CLASSES: Record<StrengthLevel, string> = {
  weak: 'bg-red-500',
  fair: 'bg-amber-500',
  good: 'bg-lime-500',
  strong: 'bg-green-600',
}

function meetsMinimumRequirements(password: string): boolean {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  )
}

// ─── Inline SVG icons ────────────────────────────────────────────────────

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 5c-7 0-11 7-11 7s1.8 3.18 5.06 5.06" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

// ─── Props ───────────────────────────────────────────────────────────────

export interface PasswordFieldProps {
  id?: string
  label?: ReactNode
  locale?: Locale
  error?: string | null
  autoFocus?: boolean
  /** Disable the input (loading / submission in progress) */
  disabled?: boolean
  /** Input name attribute (native form submission) */
  name?: string
  /** Controlled value; omit for uncontrolled */
  value?: string
  /** Called when value changes (required when value is provided) */
  onChange?: (value: string) => void
  /** Show strength meter (default: true for register; false for login) */
  showStrength?: boolean
  /** Autocomplete attribute value */
  autoComplete?: string
}

// ─── Component ───────────────────────────────────────────────────────────

export function PasswordField({
  id = 'password',
  label,
  locale = 'fa',
  error,
  autoFocus = false,
  disabled = false,
  name,
  value: externalValue,
  onChange: externalOnChange,
  showStrength = true,
  autoComplete: autoCompleteProp,
}: PasswordFieldProps) {
  const [internalValue, setInternalValue] = useState('')
  const [visible, setVisible] = useState(false)
  const [focused, setFocused] = useState(false)

  // Controlled or uncontrolled
  const isControlled = externalValue !== undefined
  const value = isControlled ? (externalValue ?? '') : internalValue
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = e.target.value
      if (isControlled) {
        externalOnChange?.(newVal)
      } else {
        setInternalValue(newVal)
      }
    },
    [isControlled, externalOnChange],
  )

  const strength = evaluateStrength(value)
  const showStrengthMeter = showStrength && focused && value.length > 0
  const meetsReq = meetsMinimumRequirements(value)

  const handleToggle = useCallback(() => {
    setVisible((v) => !v)
  }, [])

  const handleFocus = useCallback(() => {
    setFocused(true)
  }, [])

  const handleBlur = useCallback(() => {
    setFocused(false)
  }, [])

  const strengthLabel = t(STRENGTH_LABEL_KEYS[strength.level], locale)

  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          placeholder={t('auth.register.passwordPlaceholder', locale)}
          autoComplete={autoCompleteProp ?? 'new-password'}
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          aria-invalid={!!error}
          aria-describedby={
            error
              ? `${id}-error`
              : showStrengthMeter
                ? `${id}-strength`
                : undefined
          }
          className="pe-9"
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={handleToggle}
            className="absolute inset-y-0 end-0 flex items-center pe-2.5 text-muted-foreground hover:text-foreground"
            aria-label={t('auth.register.passwordVisibilityLabel', locale)}
          >
            {visible ? (
              <EyeOffIcon className="h-4 w-4" />
            ) : (
              <EyeIcon className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {!!error && (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {showStrengthMeter && (
        <div id={`${id}-strength`} className="space-y-1" aria-live="polite">
          <Progress value={strength.score}>
            <ProgressTrack>
              <ProgressIndicator
                className={`transition-all ${STRENGTH_BAR_CLASSES[strength.level]}`}
              />
            </ProgressTrack>
          </Progress>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{strengthLabel}</span>
            {!meetsReq && (
              <span className="text-muted-foreground">
                {t('auth.register.passwordRequirements', locale)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}