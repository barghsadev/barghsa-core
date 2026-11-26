import { Button, Input } from '@barghsa/ui';
import { t } from '@barghsa/i18n/workspace';
import { ChevronDownIcon } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useLocale } from '../hooks/useLocale.js';
import type { WizardFieldBinding } from '../hooks/useWizardForm.js';

const clearCode = { en: 'Clear code', fa: 'پاک کردن کد' } as const;
const automaticQuote = {
  en: 'The price updates automatically when you change the code.',
  fa: 'با تغییر کد، قیمت به‌طور خودکار به‌روز می‌شود.',
} as const;

export function CheckoutGiftCode({
  disclosureId,
  inputId,
  summary,
  label,
  application,
  field,
  value,
  maxLength,
  onChange,
  disabled,
  children,
}: {
  disclosureId?: string;
  inputId?: string;
  summary: string;
  label: string;
  application?: { applied: string; label: string; apply: (value: string) => void };
  field: WizardFieldBinding;
  value: string;
  maxLength?: number;
  onChange: (value: string) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const locale = useLocale();
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const hintId = `${id}-pending`;
  const disclosure = useRef<HTMLDetailsElement>(null);
  const code = value.trim();
  const changed = !!application && code !== application.applied;
  const canApply = !disabled && changed && Boolean(code);
  const hasCode = Boolean(value || application?.applied);
  const clearButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      className="ms-auto min-h-8 px-2 text-muted-foreground pointer-coarse:min-h-11"
      onClick={() => {
        onChange('');
        if (application?.applied) application.apply('');
        disclosure.current?.querySelector('input')?.focus();
      }}
    >
      {clearCode[locale]}
    </Button>
  );
  useEffect(() => {
    if (hasCode && disclosure.current) disclosure.current.open = true;
  }, [hasCode]);

  return (
    <div className="space-y-1">
      <details
        ref={disclosure}
        open={!application || undefined}
        className="group rounded-lg border"
      >
        <summary
          id={disclosureId}
          className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
        >
          {summary}
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
          />
        </summary>
        <div className="space-y-2 px-3 pb-3">
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              {...field}
              id={id}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              maxLength={maxLength}
              className="min-h-11 min-w-0 flex-1 basis-28"
              value={value}
              disabled={disabled}
              aria-describedby={
                [field['aria-describedby'], (!application || changed) && hintId]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (canApply) application?.apply(code);
              }}
            />
            {application ? (
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={!canApply}
                onClick={() => application.apply(code)}
              >
                {application.label}
              </Button>
            ) : (
              hasCode && clearButton
            )}
          </div>
          {!application && (
            <p id={hintId} className="text-xs text-muted-foreground">
              {automaticQuote[locale]}
            </p>
          )}
          {application && hasCode && (
            <div className="flex flex-wrap items-center gap-x-2">
              {!changed && children}
              {clearButton}
            </div>
          )}
        </div>
      </details>
      {changed && (
        <p id={hintId} role="status" className="text-xs text-muted-foreground">
          {t('electricity.order.applyGiftFirst', locale)}
        </p>
      )}
    </div>
  );
}
