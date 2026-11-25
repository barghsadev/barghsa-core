import {
  useEffect,
  useId,
  useRef,
  type Dispatch,
  type RefCallback,
  type SetStateAction,
} from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Input, Label, Textarea } from '@barghsa/ui';
import { notificationFormText, type NotificationFormKey } from '@barghsa/i18n/notification-forms';
import type { Locale } from '@barghsa/i18n/app';
import {
  NOTIFICATION_VARIABLE_DESCRIPTION_LIMIT,
  NOTIFICATION_VARIABLE_LIMIT,
  NOTIFICATION_VARIABLE_NAME_LIMIT,
  notificationVariableIssues,
  type NotificationVariableDraft,
} from '../lib/notification-form.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export function NotificationVariableFields({
  locale,
  rows,
  onChange,
  onBlur,
  fieldRef,
  disabled,
  error,
}: {
  locale: Locale;
  rows: NotificationVariableDraft[];
  onChange: Dispatch<SetStateAction<NotificationVariableDraft[]>>;
  onBlur: () => void;
  fieldRef: RefCallback<HTMLDivElement>;
  disabled: boolean;
  error?: string | undefined;
}) {
  const prefix = useId();
  const numbers = useNumberFormatting(locale);
  const pendingFocus = useRef<number | 'add' | null>(null);
  const copy = (key: NotificationFormKey) => notificationFormText(key, locale);
  const issues = error ? notificationVariableIssues(rows) : [];
  const nameId = (rowId: number) => `${prefix}-${rowId}-name`;

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    document
      .getElementById(target === 'add' ? `${prefix}-add` : `${prefix}-${target}-name`)
      ?.focus();
  }, [prefix, rows]);

  function update(
    rowId: number,
    changes: Partial<Pick<NotificationVariableDraft, 'name' | 'description'>>
  ) {
    onChange((current) =>
      current.map((row) => (row.rowId === rowId ? { ...row, ...changes } : row))
    );
  }

  return (
    <div ref={fieldRef} className="@container min-w-0 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {copy(rows.length ? 'variableHelp' : 'variableEmpty')}
        </p>
        <Button
          id={`${prefix}-add`}
          data-variable-add
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || rows.length >= NOTIFICATION_VARIABLE_LIMIT}
          onClick={() => {
            const rowId = (rows.at(-1)?.rowId ?? -1) + 1;
            pendingFocus.current = rowId;
            onChange((current) => [...current, { rowId, name: '', description: null }]);
          }}
        >
          <Plus aria-hidden="true" />
          {copy('addVariable')}
        </Button>
      </div>
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row, index) => {
            const id = `${prefix}-${row.rowId}`;
            const issue = issues[index];
            const target = issue === 'variableDescriptionTooLong' ? 'description' : 'name';
            const accessibleName = copy('variableRow').replace(
              '{number}',
              numbers.number(index + 1)
            );
            return (
              <li key={row.rowId} className="min-w-0 rounded-lg border bg-muted/25 p-2.5">
                <div
                  role="group"
                  aria-label={accessibleName}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5"
                >
                  <div className="grid min-w-0 gap-2 @sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor={nameId(row.rowId)}>{copy('variableName')}</Label>
                      <Input
                        id={nameId(row.rowId)}
                        data-variable-name
                        autoCapitalize="none"
                        spellCheck={false}
                        dir="ltr"
                        disabled={disabled}
                        aria-invalid={Boolean(issue && target === 'name') || undefined}
                        aria-describedby={issue && target === 'name' ? `${id}-error` : undefined}
                        maxLength={NOTIFICATION_VARIABLE_NAME_LIMIT}
                        placeholder={copy('variableExample')}
                        value={row.name}
                        onBlur={onBlur}
                        onChange={(event) => update(row.rowId, { name: event.target.value })}
                      />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor={`${id}-description`}>{copy('variableDescription')}</Label>
                      <Textarea
                        id={`${id}-description`}
                        data-variable-description
                        rows={1}
                        dir="auto"
                        className="min-h-11 max-h-28 resize-y bg-card py-2.5"
                        disabled={disabled}
                        aria-invalid={Boolean(issue && target === 'description') || undefined}
                        aria-describedby={
                          issue && target === 'description' ? `${id}-error` : undefined
                        }
                        maxLength={NOTIFICATION_VARIABLE_DESCRIPTION_LIMIT}
                        placeholder={copy('variableDescriptionExample')}
                        value={row.description ?? ''}
                        onBlur={onBlur}
                        onChange={(event) => update(row.rowId, { description: event.target.value })}
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    className="mt-[calc(1em+0.25rem)] text-muted-foreground"
                    title={copy('removeVariable')}
                    aria-label={`${copy('removeVariable')} ${row.name.trim() || accessibleName}`}
                    onClick={() => {
                      pendingFocus.current = (rows[index + 1] ?? rows[index - 1])?.rowId ?? 'add';
                      onChange((current) => current.filter((entry) => entry.rowId !== row.rowId));
                    }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                  {issue && (
                    <p id={`${id}-error`} className="col-span-2 text-xs text-destructive">
                      {copy(issue)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {error && !issues.some(Boolean) && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
