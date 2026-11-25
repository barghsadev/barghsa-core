import { useId, useState } from 'react';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import {
  DatePicker,
  datePickerCalendarDate,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  useFilterApply,
} from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import {
  authorizationAuditFilterKeys,
  type AuthorizationAuditFilters,
} from '../lib/authorization-audit-query.js';

export default function AuthorizationAuditFilterFields({
  draft,
  invalid,
  onChange,
}: {
  draft: AuthorizationAuditFilters;
  invalid: readonly (keyof AuthorizationAuditFilters)[];
  onChange: (key: keyof AuthorizationAuditFilters, value: string) => void;
}) {
  const locale = useLocale();
  const word = (key: string) => t(`admin.audit.authorization.${key}`, locale);
  const baseId = useId();
  const [submitted, setSubmitted] = useState(false);
  useFilterApply(() => {
    const first = invalid[0];
    if (!first) return () => {};
    setSubmitted(true);
    document.getElementById(`${baseId}-${first}`)?.focus();
    return null;
  });

  return (
    <FieldGroup className="grid gap-4 sm:grid-cols-2">
      {authorizationAuditFilterKeys.map((key) => {
        const id = `${baseId}-${key}`;
        const label = word(`filter.${key}`);
        const hasError = submitted && invalid.includes(key);
        const a11y = {
          'aria-invalid': hasError || undefined,
          'aria-describedby': hasError ? `${id}-error` : undefined,
        };
        return (
          <Field key={key} className="min-w-0">
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {key === 'from' || key === 'through' ? (
              <DatePicker
                id={id}
                label={label}
                locale={locale}
                timezone="UTC"
                value={datePickerCalendarDate(draft[key] ?? '', 'UTC')}
                onChange={(date) => onChange(key, date?.toISOString().slice(0, 10) ?? '')}
                triggerProps={a11y}
              />
            ) : (
              <Input
                id={id}
                dir="ltr"
                spellCheck={false}
                autoComplete="off"
                placeholder={word(`filter.example.${key}`)}
                value={draft[key] ?? ''}
                onChange={(event) => onChange(key, event.target.value)}
                {...a11y}
              />
            )}
            {hasError && <FieldError id={`${id}-error`}>{word(`filter.error.${key}`)}</FieldError>}
          </Field>
        );
      })}
    </FieldGroup>
  );
}
