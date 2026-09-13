import { type Locale, t } from '@barghsa/i18n/auth';
import { Input, Label, Progress, ProgressIndicator, ProgressTrack } from '@barghsa/ui';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import type { StrengthLevel, StrengthResult } from '../lib/password-strength.js';

const STRENGTH_LABEL_KEYS: Record<StrengthLevel, string> = {
  weak: 'auth.register.passwordStrengthWeak',
  fair: 'auth.register.passwordStrengthFair',
  good: 'auth.register.passwordStrengthGood',
  strong: 'auth.register.passwordStrengthStrong',
};

const STRENGTH_BAR_CLASSES: Record<StrengthLevel, string> = {
  weak: 'bg-destructive',
  fair: 'bg-warning',
  good: 'bg-info',
  strong: 'bg-success',
};

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

  const showStrengthMeter = showStrength && focused && !disabled;
  const [assessment, setAssessment] = useState<{
    input: string;
    result?: StrengthResult;
    failed?: true;
  } | null>(null);
  useEffect(() => {
    if (!showStrengthMeter || !value) return;
    let cancelled = false;
    void import('../lib/password-strength.js')
      .then(({ evaluateStrength }) => {
        if (!cancelled) setAssessment({ input: value, result: evaluateStrength(value) });
      })
      .catch(() => {
        if (!cancelled) setAssessment({ input: value, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [showStrengthMeter, value]);
  const currentAssessment = assessment?.input === value ? assessment : null;
  const strength = value ? currentAssessment?.result : { score: 0, level: 'weak' as const };
  const checkingStrength = !!value && !strength && !currentAssessment?.failed;
  const meetsReq = meetsMinimumRequirements(value);

  const handleToggle = useCallback(() => {
    setVisible((v) => !v);
  }, []);

  const strengthLabel = t(
    strength
      ? STRENGTH_LABEL_KEYS[strength.level]
      : currentAssessment?.failed
        ? 'auth.register.passwordStrengthUnavailable'
        : 'auth.register.passwordStrengthLoading',
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

      {!!error && (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Reserve space so blur cannot move the form control being clicked. */}
      {showStrength && (
        <div
          id={`${id}-strength`}
          className={`space-y-1 ${showStrengthMeter ? '' : 'invisible'}`}
          aria-hidden={!showStrengthMeter}
          aria-live="polite"
        >
          <Progress
            value={strength?.score ?? 0}
            aria-busy={checkingStrength}
            aria-label={t('auth.register.passwordStrengthLabel', locale)}
            aria-valuetext={strengthLabel}
          >
            <ProgressTrack>
              <ProgressIndicator
                className={`transition-[width] ${STRENGTH_BAR_CLASSES[strength?.level ?? 'weak']}`}
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
  );
}
