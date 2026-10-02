import { useId, type ReactNode } from 'react';
import type {
  ControllerProps,
  ControllerRenderProps,
  FieldPath,
  FieldValues,
} from 'react-hook-form';
import { FieldSet, FieldLegend } from '../components/ui/field';
import { cn } from '../lib/utils';
import { FormField, FormItem, FormLabel, FormDescription, FormMessage } from './form';

export type BoundFieldProps<
  Values extends FieldValues,
  Name extends FieldPath<Values>,
  Output,
> = Pick<
  ControllerProps<Values, Name, Output>,
  'control' | 'name' | 'rules' | 'shouldUnregister'
> & {
  label: ReactNode;
  description?: ReactNode;
  id?: string;
  itemClassName?: string;
  disabled?: boolean;
  reserveMessageSpace?: boolean;
};

/** Form values own binding; input props cannot override it. */
export type BindingKey =
  | 'id'
  | 'name'
  | 'ref'
  | 'value'
  | 'defaultValue'
  | 'checked'
  | 'defaultChecked'
  | 'onChange'
  | 'onValueChange'
  | 'onCheckedChange'
  | 'onBlur'
  | 'disabled'
  | 'render';

export function BoundField<Values extends FieldValues, Name extends FieldPath<Values>, Output>({
  control,
  name,
  rules,
  shouldUnregister,
  label,
  description,
  id: suppliedId,
  itemClassName,
  disabled,
  reserveMessageSpace = true,
  grouped = false,
  inline = false,
  renderControl,
}: BoundFieldProps<Values, Name, Output> & {
  grouped?: boolean;
  inline?: boolean;
  renderControl: (state: {
    field: ControllerRenderProps<Values, Name>;
    disabled: boolean;
    labelId: string;
  }) => ReactNode;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const labelId = `${id}-label`;
  return (
    <FormField
      {...(control ? { control } : {})}
      name={name}
      {...(rules ? { rules } : {})}
      {...(shouldUnregister !== undefined ? { shouldUnregister } : {})}
      render={({ field, fieldState, formState }) => {
        const isDisabled = Boolean(disabled || field.disabled || formState.isSubmitting);
        const input = renderControl({ field, disabled: isDisabled, labelId });
        return (
          <FormItem
            id={id}
            className={itemClassName}
            data-invalid={fieldState.invalid || undefined}
            data-disabled={isDisabled || undefined}
          >
            {grouped ? (
              <FieldSet className="gap-1">
                <FieldLegend
                  id={labelId}
                  variant="label"
                  className={cn(fieldState.invalid && 'text-destructive')}
                >
                  {label}
                </FieldLegend>
                {input}
              </FieldSet>
            ) : inline ? (
              <div className="flex items-center gap-2">
                {input}
                <FormLabel id={labelId}>{label}</FormLabel>
              </div>
            ) : (
              <>
                <FormLabel id={labelId}>{label}</FormLabel>
                {input}
              </>
            )}
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage reserveSpace={Boolean(reserveMessageSpace)} />
          </FormItem>
        );
      }}
    />
  );
}
