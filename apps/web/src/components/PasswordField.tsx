import { type Locale, t } from '@barghsa/i18n/auth';
import { Input, Label } from '@barghsa/ui';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import type { StrengthResult } from '../lib/password-strength.js';

const STRENGTH_COLORS = [
  'bg-destructive',
  'bg-destructive',
  'bg-orange-500',
  'bg-yellow-500',
  'bg-success',
];

function meetsMinimumRequirements(password: string): boolean {
  return (
    password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)
  );
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
  );
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
  );
}

// ─── Props ───────────────────────────────────────────────────────────────

export interface PasswordFieldProps {
  id?: string;
  label?: ReactNode;
  locale?: Locale;
  error?: string | null;
  /** Reserve the error line before blur validation updates it. */
  errorPlaceholder?: string | undefined;
  autoFocus?: boolean;
  /** Disable the input (loading / submission in progress) */
  disabled?: boolean;
  /** Input name attribute (native form submission) */
  name?: string;
  /** Controlled value; omit for uncontrolled */
  value?: string;
  /** Called when value changes (required when value is provided) */
  onChange?: (value: string) => void;
  /** Show strength meter (default: true for register; false for login) */
  showStrength?: boolean;
  /** Autocomplete attribute value */
  autoComplete?: string;
}

// ─── Component ───────────────────────────────────────────────────────────

export function PasswordField({
  id = 'password',
  label,
  locale = 'fa',
  error,
  errorPlaceholder,
  autoFocus = false,
  disabled = false,
  name,
  value: externalValue,
  onChange: externalOnChange,
  showStrength = true,
  autoComplete: autoCompleteProp,
}: PasswordFieldProps) {
  const [internalValue, setInternalValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);

  // Controlled or uncontrolled
  const isControlled = externalValue !== undefined;
  const value = isControlled ? (externalValue ?? '') : internalValue;
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = e.target.value;
      if (isControlled) {
        externalOnChange?.(newVal);
      } else {
        setInternalValue(newVal);
      }
    },
    [isControlled, externalOnChange]
  );

  const showStrengthMeter = showStrength && (focused || !!value) && !disabled;
  const [assessment, setAssessment] = useState<{
    input: string;
    locale: Locale;
    result?: StrengthResult;
    feedback?: { label: string; hint: string };
    failed?: true;
  } | null>(null);
  useEffect(() => {
    if (!showStrengthMeter || !value) return;
    let cancelled = false;
    void import('../lib/password-strength.js')
      .then(({ evaluateStrength, passwordStrengthFeedback }) => {
        if (!cancelled) {
          const result = evaluateStrength(value);
          setAssessment({
            input: value,
            locale,
            result,
            feedback: passwordStrengthFeedback(result.score, locale),
          });
        }
      })
      .catch(() => {
        if (!cancelled) setAssessment({ input: value, locale, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [showStrengthMeter, value, locale]);
  const currentAssessment =
    assessment?.input === value && assessment.locale === locale ? assessment : null;
  const strength = currentAssessment?.result;
  const checkingStrength = !!value && !strength && !currentAssessment?.failed;
  const meetsReq = meetsMinimumRequirements(value);
  const color = STRENGTH_COLORS[strength ? strength.score / 25 : 0]!;
  const filled = strength ? Math.max(1, strength.score / 25) : 0;

  const handleToggle = useCallback(() => {
    setVisible((v) => !v);
  }, []);

  const displayLabel =
    currentAssessment?.feedback?.label ??
    t(
      currentAssessment?.failed
        ? 'auth.register.passwordStrengthUnavailable'
        : value
          ? 'auth.register.passwordStrengthLoading'
          : 'auth.register.passwordStrengthWeak',
      locale
    );

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
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setFocused(false);
          }}
          aria-required="true"
          aria-invalid={!!error}
          aria-describedby={
            error ? `${id}-error` : showStrengthMeter ? `${id}-strength` : undefined
          }
          className="pe-12"
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={handleToggle}
            disabled={disabled}
            aria-pressed={visible}
            className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={t('auth.register.passwordVisibilityLabel', locale)}
          >
            {visible ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
          </button>
        )}
      </div>

      {(error || errorPlaceholder) && (
        <p
          id={`${id}-error`}
          aria-hidden={!error || undefined}
          className={`text-sm text-destructive${error ? '' : ' invisible'}`}
          role={error ? 'alert' : undefined}
        >
          {error || errorPlaceholder}
        </p>
      )}

      {/* Reserve space so blur cannot move the form control being clicked. */}
      {showStrength && (
        <div
          id={`${id}-strength`}
          className={`space-y-1 transition-all motion-reduce:transition-none ${showStrengthMeter ? 'translate-y-0 opacity-100' : 'invisible -translate-y-1 opacity-0'}`}
          aria-hidden={!showStrengthMeter}
          aria-live="polite"
        >
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={strength?.score ?? 0}
            className="grid h-1 w-full grid-cols-4 gap-1"
            aria-busy={checkingStrength}
            aria-label={t('auth.register.passwordStrengthLabel', locale)}
            aria-valuetext={displayLabel}
          >
            {[0, 1, 2, 3].map((segment) => (
              <span
                key={segment}
                className={`h-full rounded-full ${segment < filled ? color : 'bg-muted'}`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{displayLabel}</span>
            {!meetsReq && (
              <span className="text-muted-foreground">
                {t('auth.register.passwordRequirements', locale)}
              </span>
            )}
          </div>
          {value && currentAssessment?.feedback && (
            <p className="text-xs text-muted-foreground">{currentAssessment.feedback.hint}</p>
          )}
        </div>
      )}
    </div>
  );
}
