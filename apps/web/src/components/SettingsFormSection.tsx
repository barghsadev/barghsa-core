import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@barghsa/ui';
import { toast } from '../lib/toast-api.js';

/** Each section owns its form and actions. Callers report success only after a verified save. */
export function SettingsFormSection({
  title,
  description,
  children,
  actions,
  saved = false,
  savedMessage,
  headingId,
  className,
  ...formProps
}: Omit<ComponentProps<'form'>, 'title' | 'children'> & {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  saved?: boolean;
  savedMessage?: string;
  headingId?: string;
}) {
  const generatedId = useId(),
    heading = headingId ?? generatedId,
    announced = useRef(false);
  useEffect(() => {
    if (saved && !announced.current && savedMessage) {
      toast.success(savedMessage);
      announced.current = true;
    }
    if (!saved) announced.current = false;
  }, [saved, savedMessage]);
  return (
    <section aria-labelledby={heading} className={className}>
      <Card>
        <form {...formProps} className="flex flex-col gap-6" aria-labelledby={heading}>
          <CardHeader>
            <CardTitle>
              <h2 id={heading}>{title}</h2>
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
          <CardFooter className="flex-wrap gap-3">{actions}</CardFooter>
        </form>
      </Card>
    </section>
  );
}
