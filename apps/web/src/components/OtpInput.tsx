import {
  useRef,
  useState,
  useCallback,
  useEffect,
  forwardRef,
  useId,
  useImperativeHandle,
} from 'react';
import { cn } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/auth';

const DIGIT_COUNT = 6;

function asciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

export interface OtpInputHandle {
  reset: () => void;
  focus: () => void;
}

export interface OtpInputProps {
  locale: Locale;
  /** Optional native form binding; existing login/registration callers remain uncontrolled. */
  id?: string;
  name?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: string | null;
  onComplete?: (otp: string) => void;
  onClearError: () => void;
}

/**
 * 6-digit OTP input with individual digit boxes, auto-advance,
 * keyboard navigation, paste support, and shake animation on error.
 */
export const OtpInput = forwardRef<OtpInputHandle, OtpInputProps>(function OtpInput(
  {
    locale,
    id,
    name,
    onChange,
    disabled = false,
    autoFocus = true,
    error = null,
    onComplete,
    onClearError,
  },
  ref
) {
  const labelId = useId();
  const [digits, setDigits] = useState<string[]>(Array(DIGIT_COUNT).fill(''));
  const [shaking, setShaking] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>(Array(DIGIT_COUNT).fill(null));

  // Focus first input on mount
  useEffect(() => {
    if (autoFocus && !disabled) {
      inputRefs.current[0]?.focus();
    }
  }, [autoFocus, disabled]);

  // Shake animation when error changes from null to non-null
  useEffect(() => {
    if (error) {
      setShaking(true);
      const timer = setTimeout(() => setShaking(false), 500);
      return () => clearTimeout(timer);
    }
    return;
  }, [error]);

  const focusInput = useCallback((index: number) => {
    const el = inputRefs.current[index];
    if (el) {
      el.focus();
      el.setSelectionRange(0, el.value.length);
    }
  }, []);

  const handleChange = useCallback(
    (index: number, value: string) => {
      value = asciiDigits(value);
      // Only allow digits
      if (!/^\d*$/.test(value)) return;

      // Clear error on any user interaction
      if (error) onClearError();

      const newDigits = [...digits];
      // If pasting multiple digits starting from this position
      if (value.length > 1) {
        const chars = value.split('').slice(0, DIGIT_COUNT - index);
        for (let i = 0; i < chars.length; i++) {
          const char = chars[i] as string;
          newDigits[index + i] = char ?? '';
        }
        setDigits(newDigits);
        onChange?.(newDigits.join(''));

        // Focus the next empty slot or the last filled
        const nextEmpty = newDigits.findIndex((d) => !d);
        if (nextEmpty !== -1) {
          focusInput(nextEmpty);
        } else {
          focusInput(Math.min(index + chars.length - 1, DIGIT_COUNT - 1));
          // Auto-submit
          const otp = newDigits.join('');
          if (otp.length === DIGIT_COUNT) {
            onComplete?.(otp);
          }
        }
        return;
      }

      // Single digit
      const digit = value.slice(0, 1);
      newDigits[index] = digit;
      setDigits(newDigits);
      onChange?.(newDigits.join(''));

      if (digit && index < DIGIT_COUNT - 1) {
        // Auto-advance to next field
        focusInput(index + 1);
      }

      // Auto-submit when all 6 digits filled
      const otp = newDigits.join('');
      if (otp.length === DIGIT_COUNT && newDigits.every((d) => d)) {
        onComplete?.(otp);
      }
    },
    [digits, error, onClearError, focusInput, onComplete, onChange]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        // Move to previous field
        focusInput(index - 1);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = index > 0 ? index - 1 : DIGIT_COUNT - 1;
        focusInput(prev);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = index < DIGIT_COUNT - 1 ? index + 1 : 0;
        focusInput(next);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
      }
    },
    [digits, focusInput]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pasted = asciiDigits(e.clipboardData.getData('text/plain')).replace(/\D/g, '');
      if (!pasted) return;

      if (error) onClearError();

      const newDigits = [...digits];
      for (let i = 0; i < pasted.length && i < DIGIT_COUNT; i++) {
        const char = pasted[i] as string;
        newDigits[i] = char ?? '';
      }
      setDigits(newDigits);
      onChange?.(newDigits.join(''));

      if (pasted.length >= DIGIT_COUNT || newDigits.every((d) => d)) {
        focusInput(DIGIT_COUNT - 1);
        const otp = newDigits.join('');
        if (otp.length === DIGIT_COUNT) {
          onComplete?.(otp);
        }
      } else {
        focusInput(pasted.length);
      }
    },
    [digits, error, onClearError, focusInput, onComplete, onChange]
  );

  const handleReset = useCallback(() => {
    setDigits(Array(DIGIT_COUNT).fill(''));
    onChange?.('');
    setShaking(false);
    if (!disabled) {
      focusInput(0);
    }
  }, [disabled, focusInput, onChange]);

  useImperativeHandle(ref, () => ({ reset: handleReset, focus: () => focusInput(0) }), [
    handleReset,
    focusInput,
  ]);

  return (
    <div className="space-y-2">
      <p id={labelId} className="text-sm font-medium">
        {t('auth.otp.inputLabel', locale)}
      </p>
      <div
        className={cn(
          'grid max-w-[19rem] grid-cols-6 gap-1.5 sm:gap-2',
          shaking && 'motion-safe:animate-shake'
        )}
        dir="ltr"
        role="group"
        aria-labelledby={labelId}
      >
        {digits.map((digit, i) => (
          <input
            key={i}
            id={i === 0 ? id : undefined}
            name={i === 0 ? name : undefined}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={DIGIT_COUNT - i} // Allow paste of remaining digits
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.setSelectionRange(0, e.target.value.length)}
            disabled={disabled}
            aria-required="true"
            aria-invalid={id ? !!error : undefined}
            aria-describedby={id && error ? `${id}-error` : undefined}
            aria-label={`${t('auth.otp.digitLabel', locale)} ${i + 1}`}
            className={cn(
              'h-11 w-full min-w-0 rounded-lg border border-input bg-background text-center text-lg font-semibold text-foreground tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60',
              digit && 'bg-muted/45',
              error && 'border-destructive text-destructive'
            )}
          />
        ))}
      </div>
      {error && (
        <p id={id ? `${id}-error` : undefined} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
