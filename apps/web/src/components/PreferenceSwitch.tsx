import type { ReactNode } from 'react';
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  type FieldValues,
  type FieldPath,
  type UseFormReturn,
} from '@barghsa/ui/form';
export function PreferenceSwitch<Values extends FieldValues>({
  form,
  name,
  id,
  label,
  description,
  disabled,
  guarded,
  icon,
}: {
  form: UseFormReturn<Values>;
  name: FieldPath<Values>;
  id: string;
  label: string;
  description?: string | undefined;
  disabled: boolean;
  guarded(): boolean;
  icon?: ReactNode;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem id={id} className="min-w-0 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {icon}
              <div className="min-w-0">
                <FormLabel>{label}</FormLabel>
                {description && <FormDescription>{description}</FormDescription>}
              </div>
            </div>
            <FormControl>
              <button
                type="button"
                name={field.name}
                ref={field.ref}
                role="switch"
                aria-checked={Boolean(field.value)}
                aria-label={label}
                disabled={disabled}
                onBlur={field.onBlur}
                onClick={() => {
                  if (!disabled && !guarded()) field.onChange(!field.value);
                }}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 before:absolute before:-inset-y-2 before:inset-x-0 disabled:opacity-50 ${field.value ? 'bg-primary' : 'bg-muted-foreground/65'}`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-block size-5 rounded-full bg-card shadow-sm ${field.value ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-1 rtl:-translate-x-1'}`}
                />
              </button>
            </FormControl>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
