import { useId, type ReactNode } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { useLocale } from '../hooks/useLocale.js';

/** Previews are provided by the domain; arbitrary template HTML is never executed here. */
export function ConfigPreviewCard({
  title,
  description,
  current,
  draft,
}: {
  title: string;
  description?: ReactNode;
  current: ReactNode;
  draft: ReactNode;
}) {
  const locale = useLocale(),
    id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0" data-testid="config-preview">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={id}>{title}</h2>
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="grid min-w-0 gap-6 xl:grid-cols-2">
          {(
            [
              ['current', current],
              ['draft', draft],
            ] as const
          ).map(([key, content]) => (
            <div
              key={key}
              role="group"
              aria-labelledby={`${id}-${key}`}
              className="flex min-w-0 flex-col gap-3 break-words"
            >
              <h3 id={`${id}-${key}`} className="text-sm font-medium">
                {t(`admin.settings.${key}`, locale)}
              </h3>
              {content}
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
