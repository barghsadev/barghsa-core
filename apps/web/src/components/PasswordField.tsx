import { type Locale, t } from '@barghsa/i18n/auth';
import { meetsPasswordMinimum } from '@barghsa/shared/password-policy';
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
  labelAction?: ReactNode;
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
  labelAction,
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
  const meetsReq = meetsPasswordMinimum(value);
  const requirements = t('auth.register.passwordRequirements', locale);
  const showRequirements = showStrength && !meetsReq && error !== requirements;
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
  const errorMessage = error && (
    <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
      {error}
    </p>
  );

  return (
    <div className="space-y-1.5">
      {label && <Label htmlFor={id}>{label}</Label>}
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
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
            error ? `${id}-error` : showRequirements ? `${id}-requirements` : undefined
          }
          className="pe-12"
        />
        <button
          type="button"
          onClick={handleToggle}
          disabled={disabled || !value}
          aria-pressed={visible}
          className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring disabled:opacity-60"
          aria-label={t('auth.register.passwordVisibilityLabel', locale)}
        >
          {visible ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
        </button>
      </div>

      {labelAction ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div>{errorMessage}</div>
          {labelAction}
        </div>
      ) : (
        errorMessage
      )}
      {showRequirements && (
        <p id={`${id}-requirements`} className="text-xs leading-relaxed text-muted-foreground">
          {requirements}
        </p>
      )}
      {showStrength && (
        <div
          id={`${id}-strength`}
          className="space-y-1.5"
          hidden={!showStrengthMeter}
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
          <p className="text-xs text-muted-foreground">{displayLabel}</p>
          {value && currentAssessment?.feedback && (
            <p className="text-xs text-muted-foreground">{currentAssessment.feedback.hint}</p>
          )}
        </div>
      )}
    </div>
  );
}
