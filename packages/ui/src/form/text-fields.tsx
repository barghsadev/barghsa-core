import type { ComponentProps } from 'react';
import type { FieldPathByValue, FieldValues } from 'react-hook-form';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { BoundField, type BindingKey, type BoundFieldProps } from './bound-field';
import { FormControl } from './form';

type TextName<Values extends FieldValues> = FieldPathByValue<Values, string | null | undefined>;
export type FormInputProps<
  Values extends FieldValues,
  Name extends TextName<Values> = TextName<Values>,
  Output = Values,
> = BoundFieldProps<Values, Name, Output> & {
  inputProps?: Omit<ComponentProps<typeof Input>, BindingKey>;
};
export function FormInput<
  Values extends FieldValues,
  Name extends TextName<Values>,
  Output = Values,
>({ inputProps, ...props }: FormInputProps<Values, Name, Output>) {
  return (
    <BoundField
      {...props}
      renderControl={({ field, disabled }) => (
        <FormControl>
          <Input {...inputProps} {...field} value={field.value ?? ''} disabled={disabled} />
        </FormControl>
      )}
    />
  );
}
export type FormTextareaProps<
  Values extends FieldValues,
  Name extends TextName<Values> = TextName<Values>,
  Output = Values,
> = BoundFieldProps<Values, Name, Output> & {
  inputProps?: Omit<ComponentProps<typeof Textarea>, BindingKey>;
};
export function FormTextarea<
  Values extends FieldValues,
  Name extends TextName<Values>,
  Output = Values,
>({ inputProps, ...props }: FormTextareaProps<Values, Name, Output>) {
  return (
    <BoundField
      {...props}
      renderControl={({ field, disabled }) => (
        <FormControl>
          <Textarea {...inputProps} {...field} value={field.value ?? ''} disabled={disabled} />
        </FormControl>
      )}
    />
  );
}
export type FormPhoneInputProps<
  Values extends FieldValues,
  Name extends TextName<Values> = TextName<Values>,
  Output = Values,
> = Omit<FormInputProps<Values, Name, Output>, 'inputProps'> & {
  inputProps?: Omit<
    NonNullable<FormInputProps<Values, Name, Output>['inputProps']>,
    'type' | 'inputMode' | 'dir'
  >;
};
/** Preserve entered phone prefixes/digits; the caller's schema owns normalization. */
export function FormPhoneInput<
  Values extends FieldValues,
  Name extends TextName<Values>,
  Output = Values,
>({ inputProps, ...props }: FormPhoneInputProps<Values, Name, Output>) {
  return (
    <FormInput
      {...props}
      inputProps={{ autoComplete: 'tel', ...inputProps, type: 'tel', inputMode: 'tel', dir: 'ltr' }}
    />
  );
}
