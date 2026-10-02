import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type ReactElement,
} from 'react';
import {
  Controller,
  FormProvider,
  useFormState,
  type ControllerProps,
  type FieldError,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

export const Form = FormProvider;

const FieldContext = createContext<{ error: FieldError | undefined } | null>(null);
const ItemContext = createContext<{
  id: string;
  descriptionId: string | undefined;
  messageId: string | undefined;
  setDescriptionId: (id: string | undefined) => void;
  setMessageId: (id: string | undefined) => void;
} | null>(null);

function firstFieldError(error: unknown): FieldError | undefined {
  if (!error || typeof error !== 'object') return;
  if ('type' in error && typeof error.type === 'string') {
    return {
      type: error.type,
      ...('message' in error && typeof error.message === 'string'
        ? { message: error.message }
        : {}),
    };
  }
  // Composite controls, such as date ranges, receive errors on their child paths.
  for (const [key, value] of Object.entries(error)) {
    if (key === 'ref') continue;
    const nested = firstFieldError(value);
    if (nested) return nested;
  }
  return undefined;
}

export function FormField<
  Values extends FieldValues,
  Name extends FieldPath<Values>,
  Output = Values,
>({ render, ...props }: ControllerProps<Values, Name, Output>) {
  return (
    <Controller
      {...props}
      render={(state) => (
        <FieldContext.Provider value={{ error: firstFieldError(state.fieldState.error) }}>
          {render(state)}
        </FieldContext.Provider>
      )}
    />
  );
}

function useField() {
  const field = useContext(FieldContext);
  const item = useContext(ItemContext);
  if (!field || !item) throw new Error('Form controls require FormField and FormItem');
  return { ...field, ...item };
}

/** id names the control, so labels and existing browser selectors stay stable. */
export function FormItem({ id: suppliedId, className, ...props }: ComponentProps<'div'>) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const [descriptionId, setDescriptionId] = useState<string>();
  const [messageId, setMessageId] = useState<string>();
  const value = useMemo(
    () => ({ id, descriptionId, messageId, setDescriptionId, setMessageId }),
    [id, descriptionId, messageId]
  );
  return (
    <ItemContext.Provider value={value}>
      <div data-slot="form-item" className={cn('space-y-1', className)} {...props} />
    </ItemContext.Provider>
  );
}

export function FormLabel({ className, ...props }: ComponentProps<'label'>) {
  const { id, error } = useField();
  return (
    <label
      {...props}
      htmlFor={id}
      data-slot="form-label"
      className={cn('block text-sm font-medium', error && 'text-destructive', className)}
    />
  );
}

export function FormControl({ children }: { children: ReactElement<Record<string, unknown>> }) {
  const { id, error, descriptionId, messageId } = useField();
  const describedBy = [children.props['aria-describedby'], descriptionId, messageId]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
  return cloneElement(children, {
    id,
    'aria-invalid': error ? true : children.props['aria-invalid'],
    'aria-describedby': describedBy || undefined,
  });
}

export function FormDescription({ className, ...props }: ComponentProps<'p'>) {
  const { id, setDescriptionId } = useField();
  const descriptionId = `${id}-description`;
  useEffect(() => {
    setDescriptionId(descriptionId);
    return () => setDescriptionId(undefined);
  }, [descriptionId, setDescriptionId]);
  return (
    <p
      {...props}
      id={descriptionId}
      data-slot="form-description"
      className={cn('text-sm text-muted-foreground', className)}
    />
  );
}

export function FormMessage({
  className,
  children,
  reserveSpace = false,
  ...props
}: ComponentProps<'p'> & { reserveSpace?: boolean }) {
  const { id, error, setMessageId } = useField();
  const messageId = `${id}-message`;
  const message = error?.message ?? children;
  const present = Boolean(message);
  useEffect(() => {
    setMessageId(present ? messageId : undefined);
    return () => setMessageId(undefined);
  }, [messageId, present, setMessageId]);
  return present || reserveSpace ? (
    <p
      {...props}
      id={messageId}
      data-slot="form-message"
      role={present ? 'alert' : undefined}
      aria-hidden={present ? undefined : true}
      className={cn('text-sm text-destructive', reserveSpace && 'min-h-10', className)}
    >
      {message}
    </p>
  ) : null;
}

export function FormSubmit({ disabled, loading, ...props }: ComponentProps<typeof Button>) {
  const { isSubmitting } = useFormState();
  return <Button {...props} type="submit" disabled={disabled} loading={loading || isSubmitting} />;
}
