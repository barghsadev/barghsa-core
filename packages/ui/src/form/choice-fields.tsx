import type { ComponentProps } from 'react';
import type { FieldPathByValue, FieldValues } from 'react-hook-form';
import { Checkbox } from '../components/ui/checkbox';
import { Switch } from '../components/ui/switch';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Slider } from '../components/ui/slider';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  ComboBox,
  ComboBoxInput,
  ComboBoxPopup,
  ComboBoxItem,
  ComboBoxGroup,
  ComboBoxChips,
  ComboBoxChip,
} from '../components/base-ui/combo-box';
import { BoundField, type BindingKey, type BoundFieldProps } from './bound-field';
import { FormControl } from './form';

export interface FormChoiceOption {
  value: string;
  label: string;
  disabled?: boolean;
}
type ChoiceName<Values extends FieldValues> = FieldPathByValue<Values, string | null | undefined>;
type ToggleName<Values extends FieldValues> = FieldPathByValue<Values, boolean | undefined>;
export type FormSelectProps<
  Values extends FieldValues,
  Name extends ChoiceName<Values> = ChoiceName<Values>,
  Output = Values,
> = BoundFieldProps<Values, Name, Output> & {
  options: readonly FormChoiceOption[];
  placeholder?: string;
  triggerProps?: Omit<ComponentProps<typeof SelectTrigger>, BindingKey | 'children'>;
};
export function FormSelect<
  Values extends FieldValues,
  Name extends ChoiceName<Values>,
  Output = Values,
>({ options, placeholder, triggerProps, ...props }: FormSelectProps<Values, Name, Output>) {
  return (
    <BoundField
      {...props}
      renderControl={({ field, disabled, labelId }) => (
        <Select
          items={options}
          name={field.name}
          value={field.value || null}
          onValueChange={(value) => field.onChange(value ?? '')}
          disabled={disabled}
        >
          <FormControl>
            <SelectTrigger
              {...triggerProps}
              className={triggerProps?.className ?? 'w-full'}
              ref={field.ref}
              onBlur={field.onBlur}
              aria-labelledby={labelId}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    />
  );
}
export type FormCheckboxProps<
  Values extends FieldValues,
  Name extends ToggleName<Values> = ToggleName<Values>,
  Output = Values,
> = BoundFieldProps<Values, Name, Output> & {
  inputProps?: Omit<
    ComponentProps<typeof Checkbox>,
    BindingKey | 'inputRef' | 'indeterminate' | 'defaultIndeterminate'
  >;
};
export function FormCheckbox<
  Values extends FieldValues,
  Name extends ToggleName<Values>,
  Output = Values,
>({ inputProps, ...props }: FormCheckboxProps<Values, Name, Output>) {
  return (
    <BoundField
      {...props}
      inline
      renderControl={({ field, disabled }) => (
        <FormControl>
          <Checkbox
            {...inputProps}
            name={field.name}
            ref={field.ref}
            checked={Boolean(field.value)}
            onCheckedChange={field.onChange}
            onBlur={field.onBlur}
            disabled={disabled}
          />
        </FormControl>
      )}
    />
  );
}
export type FormSwitchProps<
  Values extends FieldValues,
  Name extends ToggleName<Values> = ToggleName<Values>,
  Output = Values,
> = BoundFieldProps<Values, Name, Output> & {
  inputProps?: Omit<ComponentProps<typeof Switch>, BindingKey | 'inputRef'>;
};
export function FormSwitch<
  Values extends FieldValues,
  Name extends ToggleName<Values>,
  Output = Values,
>({ inputProps, ...props }: FormSwitchProps<Values, Name, Output>) {
  return (
    <BoundField
      {...props}
      inline
      renderControl={({ field, disabled }) => (
        <FormControl>
          <Switch
            {...inputProps}
            name={field.name}
            ref={field.ref}
            checked={Boolean(field.value)}
            onCheckedChange={field.onChange}
            onBlur={field.onBlur}
            disabled={disabled}
          />
        </FormControl>
      )}
    />
  );
}
export type FormRadioGroupProps<
  Values extends FieldValues,
  Name extends ChoiceName<Values> = ChoiceName<Values>,
  Output = Values,
> = BoundFieldProps<Values, Name, Output> & {
  options: readonly FormChoiceOption[];
  inputProps?: Omit<ComponentProps<typeof RadioGroup>, BindingKey | 'children' | 'inputRef'>;
};
export function FormRadioGroup<
  Values extends FieldValues,
  Name extends ChoiceName<Values>,
  Output = Values,
>({ options, inputProps, ...props }: FormRadioGroupProps<Values, Name, Output>) {
  return (
    <BoundField
      {...props}
      grouped
      renderControl={({ field, disabled, labelId }) => {
        const focusValue =
          options.find((option) => !option.disabled && option.value === field.value)?.value ??
          options.find((option) => !option.disabled)?.value;
        return (
          <FormControl>
            <RadioGroup
              {...inputProps}
              name={field.name}
              value={field.value ?? ''}
              onValueChange={field.onChange}
              disabled={disabled}
              aria-labelledby={labelId}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) field.onBlur();
              }}
            >
              {options.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem
                    value={option.value}
                    disabled={option.disabled}
                    ref={option.value === focusValue ? field.ref : undefined}
                  />
                  {option.label}
                </label>
              ))}
            </RadioGroup>
          </FormControl>
        );
      }}
    />
  );
}
type ComboName<Values extends FieldValues> = FieldPathByValue<
  Values,
  string | string[] | null | undefined
>;
export type FormComboboxProps<
  Values extends FieldValues,
  Name extends ComboName<Values> = ComboName<Values>,
  Output = Values,
> = BoundFieldProps<Values, Name, Output> & {
  options: readonly FormChoiceOption[];
  placeholder?: string;
  emptyMessage: string;
  inputProps?: Omit<ComponentProps<typeof ComboBoxInput>, BindingKey>;
} & (
    | {
        multiple: true;
        name: Name & FieldPathByValue<Values, string[] | undefined>;
        removeLabel: (label: string) => string;
      }
    | { multiple?: false; name: Name & ChoiceName<Values>; removeLabel?: never }
  );
export function FormCombobox<
  Values extends FieldValues,
  Name extends ComboName<Values>,
  Output = Values,
>({
  options,
  placeholder,
  emptyMessage,
  inputProps,
  multiple = false,
  removeLabel,
  ...props
}: FormComboboxProps<Values, Name, Output>) {
  return (
    <BoundField
      {...props}
      renderControl={({ field, disabled, labelId }) => {
        const selected: string[] = Array.isArray(field.value) ? field.value : [];
        const input = (
          <FormControl>
            <ComboBoxInput
              {...inputProps}
              ref={field.ref}
              onBlur={field.onBlur}
              disabled={disabled}
              placeholder={placeholder}
              aria-labelledby={labelId}
            />
          </FormControl>
        );
        return (
          <ComboBox
            items={options.map((option) => option.value)}
            name={field.name}
            multiple={multiple}
            value={multiple ? selected : field.value || null}
            onValueChange={(value) => field.onChange(value ?? (multiple ? [] : ''))}
            disabled={disabled}
            itemToStringLabel={(value) =>
              options.find((option) => option.value === value)?.label ?? value
            }
          >
            {multiple ? (
              <ComboBoxChips>
                {selected.map((value) => {
                  const label = options.find((option) => option.value === value)?.label ?? value;
                  return (
                    <ComboBoxChip key={value} removeLabel={removeLabel!(label)}>
                      {label}
                    </ComboBoxChip>
                  );
                })}
                {input}
              </ComboBoxChips>
            ) : (
              input
            )}
            <ComboBoxPopup emptyMessage={emptyMessage}>
              <ComboBoxGroup>
                {options.map((option) => (
                  <ComboBoxItem key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </ComboBoxItem>
                ))}
              </ComboBoxGroup>
            </ComboBoxPopup>
          </ComboBox>
        );
      }}
    />
  );
}
type SliderName<Values extends FieldValues> = FieldPathByValue<Values, number | number[]>;
export type FormSliderProps<
  Values extends FieldValues,
  Name extends SliderName<Values> = SliderName<Values>,
  Output = Values,
> = BoundFieldProps<Values, Name, Output> & {
  inputProps?: Omit<ComponentProps<typeof Slider>, BindingKey | 'inputRef'>;
};
export function FormSlider<
  Values extends FieldValues,
  Name extends SliderName<Values>,
  Output = Values,
>({ inputProps, ...props }: FormSliderProps<Values, Name, Output>) {
  return (
    <BoundField
      {...props}
      grouped
      renderControl={({ field, disabled, labelId }) => (
        <FormControl>
          <Slider
            {...inputProps}
            name={field.name}
            value={
              Array.isArray(field.value) && field.value.length === 0
                ? Array.from(
                    { length: Math.max(1, inputProps?.thumbLabels?.length ?? 1) },
                    () => inputProps?.min ?? 0
                  )
                : field.value
            }
            onValueChange={field.onChange}
            inputRef={field.ref}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) field.onBlur();
            }}
            disabled={disabled}
            aria-labelledby={labelId}
          />
        </FormControl>
      )}
    />
  );
}
