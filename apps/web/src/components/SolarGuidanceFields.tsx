import { tSolarStaffRecord } from '@barghsa/i18n/solar-staff-record';
import { Button, Textarea } from '@barghsa/ui';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from '@barghsa/ui/form';
import { Plus, Trash2 } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { useLocale } from '../hooks/useLocale.js';
import { RecordEditorSection, recordEditorField, recordEditorGrid } from './RecordEditorLayout.js';

export function SolarGuidanceField<Values extends FieldValues>({
  form,
  name,
  id,
  label,
  direction,
  help,
  disabled,
  required,
}: {
  form: UseFormReturn<Values>;
  name: FieldPath<Values>;
  id: string;
  label: string;
  direction: 'rtl' | 'ltr' | 'auto';
  help?: string;
  disabled: boolean;
  required?: boolean;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem id={id} className={recordEditorField}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea
              {...field}
              value={typeof field.value === 'string' ? field.value : ''}
              aria-required={required}
              disabled={disabled}
              dir={direction}
              rows={help ? 2 : 1}
              className={help ? 'min-h-14 max-h-40 resize-y' : 'min-h-10 max-h-24 resize-none'}
            />
          </FormControl>
          {help && <FormDescription>{help}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SolarGuidanceItems({
  title,
  rows,
  disabled,
  error,
  onAdd,
  onRemove,
  renderField,
}: {
  title: string;
  rows: { id: string }[];
  disabled: boolean;
  error: string | undefined;
  onAdd: () => void;
  onRemove: (index: number) => void;
  renderField: (index: number, language: 'fa' | 'en', label: string) => ReactNode;
}) {
  const locale = useLocale();
  const add = useRef<HTMLButtonElement>(null);
  const atLimit = rows.length >= 30;
  const copy = (key: Parameters<typeof tSolarStaffRecord>[0]) => tSolarStaffRecord(key, locale);
  const numbers = new Intl.NumberFormat(locale);
  return (
    <RecordEditorSection title={title} description={copy('guidancePairHelp')}>
      {rows.map(({ id }, index) => {
        const number = numbers.format(index + 1);
        const name = copy('guidanceDocumentNumber').replace('{number}', number);
        return (
          <fieldset key={id} className="relative min-w-0 rounded-lg border px-3 pb-3 pt-2">
            <legend className="px-1 text-sm font-medium">{name}</legend>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={copy('guidanceRemoveDocument').replace('{number}', number)}
              disabled={disabled}
              className="absolute end-1 top-0 text-muted-foreground"
              onClick={() => {
                onRemove(index);
                requestAnimationFrame(() => add.current?.focus());
              }}
            >
              <Trash2 aria-hidden />
            </Button>
            <div className={`${recordEditorGrid} pt-2`}>
              {renderField(index, 'fa', copy('guidanceDocumentFa'))}
              {renderField(index, 'en', copy('guidanceDocumentEn'))}
            </div>
          </fieldset>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {atLimit && (
        <p role="status" className="text-sm text-muted-foreground">
          {copy('guidancePairLimit')}
        </p>
      )}
      <Button
        ref={add}
        type="button"
        size="sm"
        variant="outline"
        onClick={onAdd}
        disabled={disabled || atLimit}
      >
        <Plus aria-hidden />
        {copy('guidanceAddDocument')}
      </Button>
    </RecordEditorSection>
  );
}
