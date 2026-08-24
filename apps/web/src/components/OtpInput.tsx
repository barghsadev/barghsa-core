import { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react'
import { t, type Locale } from '@barghsa/i18n'

const DIGIT_COUNT = 6

export interface OtpInputHandle {
  reset: () => void
}

export interface OtpInputProps {
  locale: Locale
  disabled?: boolean
  error?: string | null
  onComplete: (otp: string) => void
  onClearError: () => void
}

/**
 * 6-digit OTP input with individual digit boxes, auto-advance,
 * keyboard navigation, paste support, and shake animation on error.
 */
export const OtpInput = forwardRef<OtpInputHandle, OtpInputProps>(function OtpInput(
  {
    locale,
    disabled = false,
    error = null,
    onComplete,
    onClearError,
  },
  ref,
) {
  const [digits, setDigits] = useState<string[]>(Array(DIGIT_COUNT).fill(''))
  const [shaking, setShaking] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>(Array(DIGIT_COUNT).fill(null))

  // Focus first input on mount
  useEffect(() => {
    if (!disabled) {
      inputRefs.current[0]?.focus()
    }
  }, [disabled])

  // Shake animation when error changes from null to non-null
  useEffect(() => {
    if (error) {
      setShaking(true)
      const timer = setTimeout(() => setShaking(false), 500)
      return () => clearTimeout(timer)
    }
    return
  }, [error])

  const focusInput = useCallback((index: number) => {
    const el = inputRefs.current[index]
    if (el) {
      el.focus()
      el.setSelectionRange(0, el.value.length)
    }
  }, [])

  const handleChange = useCallback(
    (index: number, value: string) => {
      // Only allow digits
      if (!/^\d*$/.test(value)) return

      // Clear error on any user interaction
      if (error) onClearError()

      const newDigits = [...digits]
      // If pasting multiple digits starting from this position
      if (value.length > 1) {
        const chars = value.split('').slice(0, DIGIT_COUNT - index)
        for (let i = 0; i < chars.length; i++) {
          const char = chars[i] as string
          newDigits[index + i] = char ?? ''
        }
        setDigits(newDigits)

        // Focus the next empty slot or the last filled
        const nextEmpty = newDigits.findIndex((d) => !d)
        if (nextEmpty !== -1) {
          focusInput(nextEmpty)
        } else {
          focusInput(Math.min(index + chars.length - 1, DIGIT_COUNT - 1))
          // Auto-submit
          const otp = newDigits.join('')
          if (otp.length === DIGIT_COUNT) {
            onComplete(otp)
          }
        }
        return
      }

      // Single digit
      const digit = value.slice(0, 1)
      newDigits[index] = digit
      setDigits(newDigits)

      if (digit && index < DIGIT_COUNT - 1) {
        // Auto-advance to next field
        focusInput(index + 1)
      }

      // Auto-submit when all 6 digits filled
      const otp = newDigits.join('')
      if (otp.length === DIGIT_COUNT && newDigits.every((d) => d)) {
        onComplete(otp)
      }
    },
    [digits, error, onClearError, focusInput, onComplete],
  )

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        // Move to previous field
        focusInput(index - 1)
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const prev = index > 0 ? index - 1 : DIGIT_COUNT - 1
        focusInput(prev)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        const next = index < DIGIT_COUNT - 1 ? index + 1 : 0
        focusInput(next)
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
      }
    },
    [digits, focusInput],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault()
      const pasted = e.clipboardData.getData('text/plain').replace(/\D/g, '')
      if (!pasted) return

      if (error) onClearError()

      const newDigits = [...digits]
      for (let i = 0; i < pasted.length && i < DIGIT_COUNT; i++) {
        const char = pasted[i] as string
        newDigits[i] = char ?? ''
      }
      setDigits(newDigits)

      if (pasted.length >= DIGIT_COUNT || newDigits.every((d) => d)) {
        focusInput(DIGIT_COUNT - 1)
        const otp = newDigits.join('')
        if (otp.length === DIGIT_COUNT) {
          onComplete(otp)
        }
      } else {
        focusInput(pasted.length)
      }
    },
    [digits, error, onClearError, focusInput, onComplete],
  )

  const handleReset = useCallback(() => {
    setDigits(Array(DIGIT_COUNT).fill(''))
    setShaking(false)
    if (!disabled) {
      focusInput(0)
    }
  }, [disabled, focusInput])

  // Expose reset method via ref
  useImperativeHandle(ref, () => ({ reset: handleReset }), [handleReset])

  return (
    <div className="space-y-3">
      <div
        className={`flex items-center justify-center gap-2 sm:gap-3 ${
          shaking ? 'animate-shake' : ''
        }`}
        role="group"
        aria-label={t('auth.otp.inputLabel', locale)}
      >
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={DIGIT_COUNT - i} // Allow paste of remaining digits
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            onFocus={(e) => e.target.setSelectionRange(0, e.target.value.length)}
            disabled={disabled}
            aria-label={`${t('auth.otp.digitLabel', locale)} ${i + 1}`}
            className={`w-11 h-12 sm:w-12 sm:h-13 text-center text-lg font-semibold border-b-2 rounded-none bg-transparent outline-none transition-colors ${
              error
                ? 'border-destructive text-destructive'
                : digit
                  ? 'border-primary text-foreground'
                  : 'border-muted-foreground/30 text-foreground'
            } ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'focus:border-primary focus:border-b-3'
            }`}
          />
        ))}
      </div>
      {error && (
        <p
          className="text-center text-sm text-destructive animate-fade-in"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  )
})